import { Landing  } from './pages/Landing'
import { FsckThread } from './pages/Fsck'
import { createHashRouter, RouterProvider } from 'react-router-dom'

function App() {

  const router = createHashRouter([
    { path: "/", element: <Landing />},
    { path: "/profile/:handle/post/:rkey",
      element: <FsckThread />
    }
  ])

  return (<RouterProvider router={router} />)
}

export default App
