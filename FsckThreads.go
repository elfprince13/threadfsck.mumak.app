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

type LazyPostList struct {
	post        *bsky.FeedPost // post should never be nil, we just don't want to copy
	maybeParent *func() (*LazyPostList, error)
}

// return the thread in reverse order (leaf to furthest accessible ancestor)
func fetchThreadInternal(fetchOnePost func(syntax.DID, syntax.RecordKey) (*bsky.FeedPost, error),
	resolveIdent func(syntax.AtIdentifier) (syntax.DID, error),
	did syntax.DID, rkey syntax.RecordKey) func() (*LazyPostList, error) {

	//outputPosts := make([](*bsky.FeedPost), 0, 8)

	return func() (*LazyPostList, error) {
		post, err := fetchOnePost(did, rkey)
		if err != nil {
			fmt.Println("Post fetch failed: ", err)
			return nil, err
		} else {
			var maybeParent *func() (*LazyPostList, error) = nil
			if post.Reply != nil {
				parentGenerator := func() (*LazyPostList, error) {
					maybeParentURI := post.Reply.Parent.Uri
					parentURI, err := syntax.ParseATURI(maybeParentURI)
					if err != nil {
						fmt.Println("not a syntactically valid at uri: ", maybeParentURI)
						return nil, err
					}
					identity := syntax.ATURI.Authority(parentURI)
					rkey = syntax.ATURI.RecordKey(parentURI)
					did, err = resolveIdent(identity)
					if err != nil {
						fmt.Println("could not resolve at-identity: ", err)
						return nil, err
					}
					return fetchThreadInternal(fetchOnePost, resolveIdent, did, rkey)()
				}
				maybeParent = &parentGenerator
			}
			return (&LazyPostList{
				post,
				maybeParent,
			}), nil
			//outputPosts = append(outputPosts, post)
		}
	}

	//return outputPosts, nil
}

func fetchThread(rawIdent string, rawRkey string) func() (*LazyPostList, error) {
	ctx := context.Background()
	resolveIdent := identResolverFactory(ctx, &xrpc.Client{Client: http.DefaultClient, Host: "https://public.api.bsky.app"})
	atIdent, err := syntax.ParseAtIdentifier(rawIdent)
	if err != nil {
		fmt.Println("not a syntactically valid at identifier: ", rawIdent)
		return func() (*LazyPostList, error) { return nil, err }
	}
	did, err := resolveIdent(*atIdent)
	if err != nil {
		fmt.Println("profile fetch failed: ", err)
		return func() (*LazyPostList, error) { return nil, err }
	}

	dir := identity.BaseDirectory{}

	rkey, err := syntax.ParseRecordKey(rawRkey)
	if err != nil {
		fmt.Println("not a syntactically valid rkey: ", rkey)
		return func() (*LazyPostList, error) { return nil, err }
	}

	fetchOnePost := fetchOnePostFactory(ctx, &dir)
	return fetchThreadInternal(fetchOnePost, resolveIdent, did, rkey)
}

func fetchThreadJSAsync(this js.Value, promiseArgs []js.Value) interface{} {
	promiseConstructor := js.Global().Get("Promise")
	var makeHandler func(threadThunk func() (*LazyPostList, error)) js.Func
	makeHandler = func(threadThunk func() (*LazyPostList, error)) js.Func {
		return js.FuncOf(func(innerThis js.Value, promiseHandlers []js.Value) interface{} {
			defer func() {
				if err := recover(); err != nil {
					fmt.Println(("panic occurred: "), err)
				}
			}()
			if len(promiseHandlers) != 2 {
				panic(fmt.Errorf("Incorrect number of promise handlers, expected 2 - got %d", len(promiseHandlers)))
			}
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

				thread, err := threadThunk()
				errorObject := js.Undefined()
				if err != nil {
					errorObject = errorConstructor.New(err)
					reject.Invoke(errorObject)
				} else {
					if thread.post == nil {
						panic(fmt.Errorf("post field should never be nil"))
					}

					postBytes, err := json.Marshal(thread.post)
					if err != nil {
						panic(err)
					}
					var postBytesJS js.Value = uint8ArrayConstructor.New(len(postBytes))
					js.CopyBytesToJS(postBytesJS, postBytes)

					var maybeParent js.Value = js.Undefined()
					if thread.maybeParent != nil {
						// promise constructor starts executing the asynchronous code right away
						// so wrap it in a function to avoid executing the promise until
						// our caller sees it.
						maybeParent = js.FuncOf(func(thunkThis js.Value, unused []js.Value) any {
							return promiseConstructor.New(makeHandler(*(thread.maybeParent)))
						}).Value
					}

					var returnVal js.Value = arrayConstructor.New(postBytesJS, maybeParent)

					resolve.Invoke(returnVal)
				}

			}()

			return nil
		})
	}

	fetchThreadBootStrap := func() (*LazyPostList, error) {
		if len(promiseArgs) != 2 {
			err := fmt.Errorf("Expected exactly 2 arguments")
			return nil, err
		} else {
			rawIdent := promiseArgs[0]
			rawRkey := promiseArgs[1]

			threadThunk := fetchThread(rawIdent.String(), rawRkey.String())
			return threadThunk()
		}
	}

	return promiseConstructor.New(makeHandler(fetchThreadBootStrap))
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
