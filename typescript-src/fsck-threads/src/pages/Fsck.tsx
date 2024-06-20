import { useParams } from 'react-router-dom'
import { useGo } from '../go/go'
import { lazy } from 'react'

// depends on vite's webassembly support

import wasmUrl  from '../assets/built/app.wasm?url'
import { useMemo } from 'react'

type FsckThreads_t = { fetchThread? : (handle: string, rkey: string) => Promise<[Array<Uint8Array>, Error | undefined]>}
declare global {
    export interface Window {
      FsckThreads : FsckThreads_t
    }
  }

window.FsckThreads = {}


export const FsckThread = () => {
    const { handle } = useParams<"handle">() || "";
    const { rkey } = useParams<"rkey">() || "";
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
                            try {
                                return <>{lazy(() => fetchThread(handle || "", rkey || "").then(result => {
                                    return {default : () => (<div className="alert alert-success">Got the thread!</div>) }
                                }))}</>
                            } catch (err : any) {
                                if (err instanceof Error) {
                                    return (<div className="alert alert-danger" role="alert">Something blew up while accessing the thread: {err.name} </div>)
                                } else {
                                    // dafuq is this - rethrow
                                    throw err;
                                }
                            }
                        })())
                )
            }
            </section>
        </>
        
        )
}