package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/bluesky-social/indigo/api/atproto"
	"github.com/bluesky-social/indigo/api/bsky"
	"github.com/bluesky-social/indigo/atproto/identity"
	"github.com/bluesky-social/indigo/atproto/syntax"
	"github.com/bluesky-social/indigo/xrpc"
)

//"github.com/bluesky-social/indigo/atproto/syntax"

/*
func fetchOnePost(did syntax.DID, rkey string) (*bsky.FeedPost, error) {

}
*/

func main() {
	ctx := context.Background()
	//aturi := syntax.ATURI
	handle, err := atproto.IdentityResolveHandle(ctx, &xrpc.Client{Client: http.DefaultClient, Host: "https://public.api.bsky.app"}, "elfprince13.mumak.app")
	if err != nil {
		fmt.Println("profile fetch failed: ", err)
		return
	}

	d := identity.BaseDirectory{}

	did, err := syntax.ParseDID(handle.Did)
	if err != nil {
		fmt.Println("profile contained syntactically invalid did: ", err)
		return
	}

	doc, err := d.ResolveDID(ctx, did)
	if err != nil {
		fmt.Println("DID could not be resolved: ", err)
	}

	ident := identity.ParseIdentity(doc)

	/*
		atIdent, err := syntax.ParseAtIdentifier("elfprince13.mumak.app")
		if err != nil {
			fmt.Println("parse failed: ", err)
			return
		}

		d := identity.BaseDirectory{}
		ident, err := d.Lookup(context.TODO(), *atIdent)
		if err != nil {
			fmt.Println("id lookup failed: ", err)
			return
		}*/

	pdsClient := xrpc.Client{Client: http.DefaultClient, Host: ident.PDSEndpoint()}
	//dummyPost := bsky.FeedPost{Text: "poo", CreatedAt: "yoo-hoo"}
	//fmt.Println("Dummy Post: ", dummyPost)
	out, err := atproto.RepoGetRecord(ctx, &pdsClient, "", "app.bsky.feed.post", did.String(), "3kmh2hea4f42j")
	if err != nil {
		fmt.Println("repo get record failed: ", err)
	}
	post, ok := out.Value.Val.(*bsky.FeedPost)
	if !ok {
		fmt.Println("Post was not a post! ", out)
	}
	fmt.Println(*post)

	if err != nil {
		fmt.Println(err)
		return
	}
}
