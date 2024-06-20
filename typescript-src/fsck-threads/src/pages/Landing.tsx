import { useState } from 'react'
import reactLogo from '../assets/react.svg'
import viteLogo from '/vite.svg'



export const Landing = () => {
    const [count, setCount] = useState(0)

  return (
    <>
      <header className="d-flex flex-wrap justify-content-center py-3 mb-4 border-bottom">
        <a className="d-flex align-items-center mb-3 mb-md-0 me-md-auto link-body-emphasis text-decoration-none" href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </header>
      <section className="py-5 text-center container">
        <h1 className="fw-light">Vite + React</h1>
        <div className="card">
          <button className="btn btn-primary rounded-pill px-3" onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
      </section>
      
      <section className="py-5 text-center container">
        <p className="card">
        Click on the Vite and React logos to learn more
        </p>
      </section>
    </>
  )
}