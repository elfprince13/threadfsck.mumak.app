import { useParams } from 'react-router-dom'
import { useGo } from '../go/go'
import { Fragment, ReactElement, useEffect, useMemo, useState } from 'react'
import { /*AppBskyActorDefs,*/ AppBskyActorProfile, AppBskyEmbedExternal, AppBskyEmbedImages, AppBskyEmbedRecord, AppBskyEmbedRecordWithMedia, AppBskyFeedPost, AppBskyRichtextFacet, jsonStringToLex } from '@atproto/api'
import { AtUri, /*BskyAgent,*/ RichText, RichTextProps } from '@atproto/api'

// depends on vite's webassembly support
import wasmUrl  from '../assets/built/app.wasm?url'

type MaybeFetchParent = undefined | (() => LazyThread)
type LazyThread = Promise<[Uint8Array, MaybeFetchParent]>
type ResolveIdent = (handle: string) => Promise<string>
type FetchThread = (handle: string, rkey: string) => LazyThread
type FetchProfile = (handle: string) => Promise<Uint8Array>
type FsckThreads_t = { resolveIdent: ResolveIdent, fetchThread : FetchThread, fetchProfile : FetchProfile}
declare global {
    export interface Window {
      FsckThreads : FsckThreads_t
    }
  }

window.FsckThreads = (function(): FsckThreads_t {
    const stay = function(): never {
        throw new Error("Go has no yet loaded!")
    }
    return {
        resolveIdent: () => new Promise<string>(stay),
        fetchThread: () => new Promise<[Uint8Array, MaybeFetchParent]>(stay),
        fetchProfile: () => new Promise<Uint8Array>(stay)
    }
})()

const UNKNOWN_HANDLE = "<UNKNOWN HANDLE>"


const decoder = new TextDecoder('utf-8')
function bytesToLex(bytes : Uint8Array) {
    const text = decoder.decode(bytes)
    return jsonStringToLex(text)
}

function handleToLink(handle : string) {
    return `https://bsky.app/profile/${handle}`
}

function tagToLink(tag : string) {
    return `https://bsky.app/hashtag/${tag}`
}

export const DisplayUserCardHeader = (props : {did : string}) => {
    const handle = props.did
    const [ profileData, setProfileData ] = useState<undefined | AppBskyActorProfile.Record>(undefined)

    useEffect(() => {
        async function getProfile() {
            if (handle === UNKNOWN_HANDLE) {
                console.log("not ready to fetch profile")
                return
            }
            try {
                console.log("Getting profile for ", handle)
                const profileBytes = await window.FsckThreads.fetchProfile(handle)
                const profile = bytesToLex(profileBytes)
                if ( AppBskyActorProfile.isRecord(profile)) {
                    const res = AppBskyActorProfile.validateRecord(profile)
                    if (res.success ) {
                        console.log("got a profile!", profile)
                        setProfileData(profile)
                    } else {
                        console.log("invalid profile =(?!?", profile)
                        throw res.error
                    }
                } else {
                    console.log("Not an AppBskyActorProfile: ", profile)
                    throw new TypeError(`Expected AppBskyActorProfile, received: ${profile}`)
                }
            } catch(err) {
                console.log("Failed to get profile", err)
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
            <a href={handleToLink(handle)} className="link-secondary">
                {
                    ((profileData === undefined)
                        ? handle
                        : (<>
                            <img src={`https://cdn.bsky.app/img/avatar/plain/${handle}/${profileData.avatar?.ref.toString()}@${profileData.avatar?.mimeType.split("/").slice(-1)[0]}`} className="img-fluid float-start" style={{maxWidth: 48, maxHeight: 48, borderRadius: 24}} alt={`Profile picture for ${profileData.displayName} (${handle})`} />
                            {profileData.displayName}<br/>
                            {handle}
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

type EmbedUnion = AppBskyEmbedImages.Main
                | AppBskyEmbedExternal.Main
                | AppBskyEmbedRecord.Main
                | AppBskyEmbedRecordWithMedia.Main
                | { $type: string; [k: string]: unknown }
export const DisplayEmbed = (props : {embed : EmbedUnion, maxEmbedDepth: number}) => {
    if (AppBskyEmbedImages.isMain(props.embed)) {
        return
    } else {
        return <div className="card">
            <div className="card-body">
                <p className="card-text">
                    Unknown embed {props.embed.$type as string}!
                </p>
            </div>
        </div>
    }
}

export const DisplayPost = (props : {post : AppBskyFeedPost.Record, link?: AtUri, maxEmbedDepth?: number}) => {
    const link = props.link
    const timestamp = props.post.createdAt
    const handle = (link || {hostname: undefined}).hostname


    const [ did, setDid ] = useState<undefined | string>(undefined)

    useEffect(() => {
        async function resolveDid() {
            try {
                const did = await window.FsckThreads.resolveIdent(handle || "")
                setDid(did)
            } catch(err) {
                console.log("Failed to resolve did", err)
                // arcane nonsense, not a real error from us!
                if(!(err instanceof Error)) {
                    throw err
                }
            }
        }

        resolveDid();
    }, [handle])

    const stamplink = useMemo((() => 
        ((link === undefined)
            ? ((e: ReactElement) => e)
            : ((e: ReactElement) => (<a href={`https://bsky.app/profile/${did}/post/${link.rkey}`} className="link-secondary">{e}</a>)))(<>Posted {timestamp}</>)
        ), [did, link, timestamp])
    return (<div className="card">
        <DisplayUserCardHeader did={(did === undefined) ? UNKNOWN_HANDLE : did} />
        <div className="card-body">
            <p className="card-text">
                <DisplayRichText text={props.post.text} facets={props.post.facets} />
            </p>
            {
                (props.post.embed === undefined) ? <></> : <DisplayEmbed embed={props.post.embed} maxEmbedDepth={1} />
            }
        </div>
        <div className="card-footer text-muted">
            {stamplink} {(props.post.tags || []).map((tag) => {
                return <a href={tagToLink(tag)} key={tag}>tag</a>
            })}
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

                const post = bytesToLex(postBytes)
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
            orderedPosts.map((postOrError, index) => (<PostOrError maybePost={postOrError.post} link={postOrError.link} key={orderedPosts.length - index} />))
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
            <section className="py-5 text-left container">
            {
                (goIsLoading
                    ? (<div className="alert alert-primary text-center" role="alert">Still Loading</div>)
                    : ((window.FsckThreads === undefined)
                        ? (<div className="alert alert-danger" role="alert">Dynamic linking of Go module failed. Could not access fetchThread() </div>)
                        : (() => {
                            // apparently type checking figures out this can't be undefined
                            // only if we assign it to a local
                            return (<ThreadLoader nextPost={(() => window.FsckThreads.fetchThread(handle, rkey))} rootLink={atURI} />)
                        })())
                )
            }
            </section>
        </>
        
        )
}