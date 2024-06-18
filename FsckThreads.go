package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"syscall/js"

	"github.com/bluesky-social/indigo/api/atproto"
	"github.com/bluesky-social/indigo/api/bsky"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/bluesky-social/indigo/xrpc"
)

func fetchOnePostFactory(ctx context.Context, dir *identity.BaseDirectory) func(did syntax.DID, rkey syntax.RecordKey) (*bsky.FeedPost, error) {

	hostCache := map[syntax.DID]xrpc.Client{}

	return func(did syntax.DID, rkey syntax.RecordKey) (*bsky.FeedPost, error) {
		fmt.Println("fetching ", did.String(), "/", rkey.String())
		pdsClient, ok := hostCache[did]
		if !ok {
			doc, err := dir.ResolveDID(ctx, did)
			if err != nil {
				return nil, err
			}

			ident := identity.ParseIdentity(doc)
			pdsClient = xrpc.Client{Client: http.DefaultClient, Host: ident.PDSEndpoint()}
			hostCache[did] = pdsClient
		}

		out, err := atproto.RepoGetRecord(ctx, &pdsClient, "", "app.bsky.feed.post", did.String(), rkey.String())
		if err != nil {
			return nil, err
		}
		post, ok := out.Value.Val.(*bsky.FeedPost)
		if !ok {
			return nil, err
		}

		return post, nil
	}
}

func identResolverFactory(ctx context.Context, resolverClient *xrpc.Client) func(syntax.AtIdentifier) (syntax.DID, error) {
	handleCache := map[syntax.AtIdentifier]syntax.DID{}

	return func(atIdent syntax.AtIdentifier) (syntax.DID, error) {
		fmt.Println("resolving ", atIdent.String())
		did, ok := handleCache[atIdent]
		if ok {
			return did, nil
		}

		did, err := atIdent.AsDID()
		if nil != err {
			handle, err := atIdent.AsHandle()
			if nil != err {
				return "", fmt.Errorf("at-identifier neither a Handle nor a DID")
			} else {
				responseDoc, err := atproto.IdentityResolveHandle(ctx, resolverClient, handle.String())
				if err != nil {
					return "", fmt.Errorf("profile fetch failed: {}", err)
				}

				did, err = syntax.ParseDID(responseDoc.Did)
				if err != nil {
					return "", fmt.Errorf("profile contained syntactically invalid did: ", err)
				}

			}
		}
		handleCache[atIdent] = did

		return did, nil

	}
}

// return the thread in reverse order (leaf to furthest accessible ancestor)
func fetchThreadInternal(fetchOnePost func(syntax.DID, syntax.RecordKey) (*bsky.FeedPost, error),
	resolveIdent func(syntax.AtIdentifier) (syntax.DID, error),
	did syntax.DID, rkey syntax.RecordKey) ([](*bsky.FeedPost), error) {

	outputPosts := make([](*bsky.FeedPost), 0, 8)

	post, err := fetchOnePost(did, rkey)
	if err != nil {
		fmt.Println("Post fetch failed: ", err)
		return outputPosts, err
	} else {
		outputPosts = append(outputPosts, post)
	}

	for post.Reply != nil {
		maybeParentURI := post.Reply.Parent.Uri
		parentURI, err := syntax.ParseATURI(maybeParentURI)
		if err != nil {
			fmt.Println("not a syntactically valid at uri: ", maybeParentURI)
			return outputPosts, err
		}
		identity := syntax.ATURI.Authority(parentURI)
		rkey = syntax.ATURI.RecordKey(parentURI)
		did, err = resolveIdent(identity)
		if err != nil {
			fmt.Println("could not resolve at-identity: ", err)
			return outputPosts, err
		}
		post, err = fetchOnePost(did, rkey)
		if err != nil {
			fmt.Println("Post fetch failed: ", err)
			return outputPosts, err
		} else {
			outputPosts = append(outputPosts, post)
		}
	}

	return outputPosts, nil
}

// return the thread in reverse order (leaf to furthest accessible ancestor)
func fetchThread(rawIdent string, rawRkey string) ([](*bsky.FeedPost), error) {
	ctx := context.Background()
	resolveIdent := identResolverFactory(ctx, &xrpc.Client{Client: http.DefaultClient, Host: "https://public.api.bsky.app"})
	atIdent, err := syntax.ParseAtIdentifier(rawIdent)
	if err != nil {
		fmt.Println("not a syntactically valid at identifier: ", rawIdent)
		return nil, err
	}
	did, err := resolveIdent(*atIdent)
	if err != nil {
		fmt.Println("profile fetch failed: ", err)
		return nil, err
	}

	dir := identity.BaseDirectory{}

	rkey, err := syntax.ParseRecordKey(rawRkey)
	if err != nil {
		fmt.Println("not a syntactically valid rkey: ", rkey)
		return nil, err
	}

	fetchOnePost := fetchOnePostFactory(ctx, &dir)
	return fetchThreadInternal(fetchOnePost, resolveIdent, did, rkey)
}

func fetchThreadJSAsync(this js.Value, promiseArgs []js.Value) interface{} {
	handler := js.FuncOf(func(innerThis js.Value, promiseHandlers []js.Value) interface{} {
		defer func() {
			if err := recover(); err != nil {
				fmt.Println(("panic occurred: "), err)
			}
		}()
		// there's nothing we can do if these don't follow the API for promise
		// mysterious runtime error will likely manifest.
		// cf. https://stackoverflow.com/questions/67437284/how-to-throw-js-error-from-go-web-assembly
		resolve := promiseHandlers[0]
		reject := promiseHandlers[1]
		errorConstructor := js.Global().Get("Error")
		arrayConstructor := js.Global().Get("Array")
		uint8ArrayConstructor := js.Global().Get("Uint8Array")

		go func() {
			defer func() {
				defer func() {
					if err := recover(); err != nil {
						fmt.Println("Unrecoverable panic! rebooting")
					}
				}()

				if err := recover(); err != nil {
					errorObject := errorConstructor.New(err)
					reject.Invoke(errorObject)
				}
			}()

			if len(promiseArgs) != 2 {
				err := fmt.Errorf("Expected exactly 2 arguments")
				errorObject := errorConstructor.New(err.Error())
				reject.Invoke(errorObject)
			} else {
				rawIdent := promiseArgs[0]
				rawRkey := promiseArgs[1]

				thread, err := fetchThread(rawIdent.String(), rawRkey.String())
				errorObject := js.Undefined()
				if err != nil {
					errorObject = errorConstructor.New(err)
				}
				if len(thread) < 1 {
					reject.Invoke(errorObject)
				} else {
					postCount := len(thread)
					// must be generic because apparently ... spreading doesn't lower types as needed?
					threadJS := make([](any), 0, postCount)
					for postCount = postCount - 1; postCount >= 0; postCount = postCount - 1 {
						postBytes, err := json.Marshal(thread[postCount])
						if err != nil {
							panic(err)
						}
						var postBytesJS js.Value = uint8ArrayConstructor.New(len(postBytes))
						js.CopyBytesToJS(postBytesJS, postBytes)
						threadJS = append(threadJS, postBytesJS)
					}
					var threadBytesJS js.Value = arrayConstructor.New(threadJS...)
					var returnVal = arrayConstructor.New(threadBytesJS, errorObject)

					resolve.Invoke(returnVal)
				}

			}
		}()

		return nil
	})

	promiseConstructor := js.Global().Get("Promise")
	return promiseConstructor.New(handler)
}

func main() {
	c := make(chan struct{}, 0)

	targetObjName := os.Getenv("BIND_FUNCTIONS_TO_GLOBAL")
	fsckThreadsObj := js.Global().Get(targetObjName)
	fsckThreadsObj.Set("fetchThread", js.FuncOf(fetchThreadJSAsync))

	<-c

	/*
		rawIdent := "elfprince13.mumak.app"
		rawRkey := "3kmh2hea4f42j"
		thread, err := fetchThread(rawIdent, rawRkey)
		if err != nil {
			fmt.Println("Thread retrieval terminated abnormally: ", err)
		}
		for i := len(thread) - 1; i > 0; i = i - 1 {
			fmt.Println(thread[i].Text)
		}
	*/
}
