import { useParams } from 'react-router-dom'
import { useGo } from '../go/go'
import { useEffect, useState } from 'react'

// depends on vite's webassembly support

import wasmUrl  from '../assets/built/app.wasm?url'
import { useMemo } from 'react'
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

export const ThreadLoader = (props : {nextPost : () => LazyThread}) => {
    console.log("first nextPost", props.nextPost)
    // stupid shenanigans: useState tries to "helpfully" unpack function values
    // without knowing if the function has the right type to do so.
    const [ nextPost, setNextPost ] = useState<MaybeFetchParent>((() => props.nextPost))
    const [ postsSoFar, setPostsSoFar ] = useState<Array<Error | Uint8Array>>([])

    useEffect(() => {
        console.log("ThreadLoader: effect handler running")
        async function fetchPosts() {
            console.log("Inside fetchPosts, nextPost is ", nextPost, " postsSoFar is ", postsSoFar)
            if ( nextPost === undefined ) {
                console.log("done fetching all posts!")
            } else if ( typeof(nextPost) === 'function') {
              console.log("Invoking nextPost")
              try {
                const [post, nextThunk] = await nextPost();
                console.log(`received post (${typeof(post)}) and nextThunk (${typeof(nextThunk)})`)
                // stupid shenanigans: useState tries to "helpfully" unpack function values
                // without knowing if the function has the right type to do so.
                setPostsSoFar(postsSoFar.concat([post]))
                setNextPost((() => nextThunk))
              } catch (err) {
                console.log('caught err from WASM: ', err)
                if (err instanceof Error) {
                    setPostsSoFar(postsSoFar.concat([err]));
                    setNextPost(undefined)
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
        console.log("ThreadLoading: Calling fetchPosts")
        fetchPosts()
    }, [nextPost, postsSoFar])

    return <>
        <>{ (() =>
        ((nextPost === undefined) 
         ? <div className="alert alert-success" role="alert">Got the thread! ({postsSoFar.length} results)</div>
         : <div className="alert alert-info" role="alert">Fetching the thread! ({postsSoFar.length} / ? results)</div>))()
        }</>
        
        {/* <>{ () =>
            <div className="alert alert-danger" role="alert">Something blew up while accessing the thread: {err.name} </div>
        
        }</> */}
        
    </>

}


export const FsckThread = () => {
    const handle = useParams<"handle">().handle || "";
    const rkey = useParams<"rkey">().rkey || "";
    const bskyURL = useMemo(() => `bsky://profile/${handle}/post/${rkey}`, [handle, rkey])

    const goIsLoading = useGo(wasmUrl, [], {BIND_FUNCTIONS_TO_GLOBAL : "FsckThreads"})


    console.log("have access to rkey and handle now!")
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
                            return (<ThreadLoader nextPost={(() => fetchThread(handle, rkey))} />)
                        })())
                )
            }
            </section>
        </>
        
        )
}