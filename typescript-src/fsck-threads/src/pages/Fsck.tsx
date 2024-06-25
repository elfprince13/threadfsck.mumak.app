import { useParams } from 'react-router-dom'
import { useGo } from '../go/go'
import { Fragment, ReactElement, useEffect, useMemo, useState } from 'react'
import { AppBskyActorDefs, AppBskyActorProfile, AppBskyFeedPost, AppBskyRichtextFacet } from '@atproto/api'
import { AtUri, BskyAgent, RichText, RichTextProps } from '@atproto/api'

// depends on vite's webassembly support
import wasmUrl  from '../assets/built/app.wasm?url'
import { ProfileViewDetailed } from '@atproto/api/dist/client/types/app/bsky/actor/defs'

type MaybeFetchParent = undefined | (() => LazyThread)
type LazyThread = Promise<[Uint8Array, MaybeFetchParent]>
type FetchThread = (handle: string, rkey: string) => LazyThread
type FsckThreads_t = { fetchThread? : FetchThread}
declare global {
    export interface Window {
      FsckThreads : FsckThreads_t
    }
  }

window.FsckThreads = {}

const decoder = new TextDecoder('utf-8')
function bytesToJson(bytes : Uint8Array) {
    const text = decoder.decode(bytes)
    return JSON.parse(text)
}

function handleToLink(handle : string) {
    return `https://bsky.app/profile/${handle}`
}

function tagToLink(tag : string) {
    return `https://bsky.app/hashtag/${tag}`
}

const agent = new BskyAgent({
    service: 'https://public.api.bsky.app'
})

export const DisplayUserCardHeader = (props : {handle : string}) => {
    const handle = props.handle
    const [ profileData, setProfileData ] = useState<undefined | AppBskyActorDefs.ProfileViewDetailed>(undefined)

    useEffect(() => {
        async function getProfile() {
            try {
                const {success, headers, data} = await agent.getProfile({actor : handle})
                if(!success) {
                    console.log("Failed to access profile =(", headers, data)
                    throw new Error("Could not access profile!")
                }
                setProfileData(data)
            } catch(err) {
                // arcane nonsense, not a real error from us!
                if(!(err instanceof Error)) {
                    throw err
                }
            }
        }
        if(profileData === undefined) {
            getProfile()
        }
    }, [profileData, handle])

    return <div className="card-header">
            <a href={handleToLink(props.handle)} className="link-secondary">
                {
                    ((profileData === undefined)
                        ? handle
                        : (<>
                            <img src={profileData.avatar} className="img-fluid" style={{maxWidth: 48, maxHeight: 48, borderRadius: 24}} alt={`Profile picture for ${profileData.displayName} (${props.handle})`} />
                            {profileData.displayName}
                           </>))
                }
            </a>
    </div>
}

export const DisplayRichText = (props : RichTextProps) => {
    const rt = new RichText(props)
    const segmentGenerator = rt.segments();
    const segments = [...segmentGenerator]
    return segments.map((segment, index) => {
        {
            const maybeLink = segment.link
            // todo this gets called twice - once here and once by the link property
            if (AppBskyRichtextFacet.isLink(maybeLink)) {
                return <a href={maybeLink.uri} className="primary-link" key={index}>{segment.text}</a>
            }
        }
        {
            const maybeMention = segment.mention
            if (AppBskyRichtextFacet.isMention(maybeMention)) {
                return <a href={handleToLink(maybeMention.did)} className="primary-link" key={index}>{segment.text}</a>
            }
        }
        {
            const maybeTag = segment.tag
            if (AppBskyRichtextFacet.isTag(maybeTag)) {
                return <a href={tagToLink(maybeTag.tag)} className="primary-link" key={index}>{segment.text}</a>
            }
        }
        return <Fragment key={index}>{segment.text}</Fragment>
    })
}

export const DisplayError = (props : {error : Error, link?: AtUri}) => {
    return (
        <div className="card">
            <div className="card-header">
                Error fetching post from bluesky!
            </div>
            <div className="card-body">
                <div className="alert alert-danger" role="alert">
                    <h4 className="alert-heading">{props.error.name} {(props.link === undefined) ? "" : `(Accessing ${props.link})`}</h4>
                    <hr/>
                    <p className="mb-0">{props.error.message}</p>
                </div>
            </div>
        </div>
    )
}

export const DisplayPost = (props : {post : AppBskyFeedPost.Record, link?: AtUri}) => {
    const link = props.link
    const timestamp = props.post.createdAt
    const stamplink = useMemo((() => 
        ((link === undefined)
            ? ((e: ReactElement) => e)
            : ((e: ReactElement) => (<a href={`https://bsky.app/profile/${link.hostname}/post/${link.rkey}`} className="link-secondary">{e}</a>)))(<>Posted {timestamp}</>)
        ), [link, timestamp])
    return (<div className="card">
        <DisplayUserCardHeader handle={(link === undefined) ? "<UNKNOWN HANDLE>" : link.hostname} />
        <div className="card-body">
            <p className="card-text">
                <DisplayRichText text={props.post.text} facets={props.post.facets} />
            </p>
        </div>
        <div className="card-footer text-muted">
            {stamplink}
        </div>
    </div>)
}

export const PostOrError = (props : {maybePost : Error | AppBskyFeedPost.Record, link?: AtUri}) => {
    const maybePost = props.maybePost
    const link = props.link

    const tag = useMemo(() => {
        if (maybePost instanceof Error) {
            const error : Error = maybePost
            return (<DisplayError error={error} link={link} />)
        } else if (AppBskyFeedPost.isRecord(maybePost)) {
            return (<DisplayPost post={maybePost} link={link} />)
        } else {
            console.log("Not an Error | Uint8Array: ", maybePost)
            return (<DisplayError error = {new TypeError(`Expected Error | Uint8Array, received: ${maybePost}`)} />)
        }
    }, [maybePost, link])

    return tag
}

type MaybePostAndLink = {
    post: Error | AppBskyFeedPost.Record
    link?: AtUri
}

export const ThreadLoader = (props : {rootLink : AtUri, nextPost : () => LazyThread}) => {
    // stupid shenanigans: useState tries to "helpfully" unpack function values
    // without knowing if the function has the right type to do so.
    const [ nextPost, setNextPost ] = useState<MaybeFetchParent>((() => props.nextPost))
    const [ postsSoFar, setPostsSoFar ] = useState<Array<MaybePostAndLink>>([])
    const [ nextLink, setNextLink ] = useState<AtUri | undefined>(props.rootLink)

    useEffect(() => {
        async function fetchPosts() {
            let keepTrying = false
            let gotPost = false
            if ( nextPost === undefined ) {
                console.log("done fetching all posts!")
            } else if ( typeof(nextPost) === 'function') {
              try {
                const [postBytes, nextThunk] = await nextPost();
                console.log(`received post (${typeof(postBytes)}) and nextThunk (${typeof(nextThunk)})`)        

                // stupid shenanigans: useState tries to "helpfully" unpack function values
                // without knowing if the function has the right type to do so.
                setNextPost((() => nextThunk))
                keepTrying = true

                const post = bytesToJson(postBytes)
                if ( AppBskyFeedPost.isRecord(post)) {
                    const res = AppBskyFeedPost.validateRecord(post)
                    if (res.success) {
                        // we have a valid post!                        
                        setPostsSoFar(postsSoFar.concat([{ post: post, link: nextLink }]))
                        gotPost = true
                        if (post.reply !== undefined) {
                            // this should be equiv
                            setNextLink(new AtUri(post.reply.parent.uri))
                        } else if (nextThunk !== undefined) {
                            throw new Error("Unexpected state: this post is not a reply but nextPost gave us a thunk?!?")
                        }
                    } else {
                        throw res.error
                    }
                } else {
                    console.log("Not an AppBskyFeedPost: ", post)
                    throw new TypeError(`Expected AppBskyFeedPost, received: ${post}`)
                }
              } catch (err) {
                console.log('caught err retrieving and parsing post: ', err)
                if (err instanceof Error) {
                    if (keepTrying) {
                        if(gotPost) {
                            setPostsSoFar(postsSoFar.concat([{post: err, link: nextLink}]));
                        }
                    } else {
                        setNextPost(undefined)                        
                    }

                    setNextLink(undefined)
                } else {
                    console.log("YIKE! Not even a real error ", err)
                    // don't know what this is
                    throw err
                }
              }
            } else {
                console.log("oops, not a function or undefined?", nextPost)
                throw new TypeError(`undefined | (() => LazyThread) expected, received: ${nextPost}`)
            }
        }
        fetchPosts()
    }, [nextPost, postsSoFar, nextLink])

    const orderedPosts = useMemo(() => [...postsSoFar].reverse(), [postsSoFar])

    return <>
        <>{ 
        ((nextPost === undefined) 
         ? <div className="alert alert-success" role="alert">Got the thread! ({postsSoFar.length} results)</div>
         : <div className="alert alert-info" role="alert">Fetching the thread! ({postsSoFar.length} / ? results)</div>)
        }</>
        
        <>{ 
            orderedPosts.map((postOrError, index) => (<PostOrError maybePost={postOrError.post} link={postOrError.link} key={index} />))
        }</>
        
    </>

}


export const FsckThread = () => {
    const handle = useParams<"handle">().handle || "";
    const rkey = useParams<"rkey">().rkey || "";
    const bskyURL = useMemo(() => `bsky://profile/${handle}/post/${rkey}`, [handle, rkey])
    const atURI = useMemo(() => new AtUri(`at://${handle}/app.bsky.feed.post/${rkey}`), [handle, rkey])

    const goIsLoading = useGo(wasmUrl, [], {BIND_FUNCTIONS_TO_GLOBAL : "FsckThreads"})

    return (
        <>
            <header className="d-flex flex-wrap justify-content-center py-3 mb-4 border-bottom">
                Archiving thread from leaf at <a href={bskyURL} className="link-info">{bskyURL}</a>
            </header>
            <section className="py-5 text-center container">
            {
                (goIsLoading
                    ? (<div className="alert alert-primary" role="alert">Still Loading</div>)
                    : ((window.FsckThreads.fetchThread === undefined)
                        ? (<div className="alert alert-danger" role="alert">Dynamic linking of Go module failed. Could not access fetchThread() </div>)
                        : (() => {
                            // apparently type checking figures out this can't be undefined
                            // only if we assign it to a local
                            const fetchThread = window.FsckThreads.fetchThread
                            return (<ThreadLoader nextPost={(() => fetchThread(handle, rkey))} rootLink={atURI} />)
                        })())
                )
            }
            </section>
        </>
        
        )
}