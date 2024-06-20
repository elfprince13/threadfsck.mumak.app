import { useParams } from 'react-router-dom'
import { Go } from '../LoadWasm/wasm_exec'



export const FsckThread = () => {
    const { handle } = useParams<"handle">();
    const { rkey } = useParams<"rkey">();
  return (
    <>
      <header className="d-flex flex-wrap justify-content-center py-3 mb-4 border-bottom">
        {handle} / {rkey}
      </header>
    </>
  )
}