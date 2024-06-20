import { Go, GoEnvVars, GoArgs } from './wasm_exec.ts'

import { useEffect, useState } from 'react'

// should be an asset URL provided by vite or similar bundler
async function loadGoWasm(wasmUrl: string, argv?: GoArgs, env?: GoEnvVars): Promise<void> {
    const go = new Go();
    if (argv !== undefined) {
      go.argv = go.argv.concat(argv)
    }
    if (env !== undefined) {
      go.env = env
    }
      go.exit = (code) => {
        if (code !== 0) {
          throw new Error("Go runtime exited abnormally with code " + code);
        }
      };
      // instance -> result.instance if we lose the vite dependency
      return WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject).then( result => {
        go.run(result.instance)
      })
  }
  
  export const useGo = (wasmUrl: string, argv?: GoArgs, env?: GoEnvVars) => {
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      loadGoWasm(wasmUrl, argv, env).then(() => {
        console.log("Done loading")
        setIsLoading(false);
      });
    }, []);
    
    return isLoading;
  };
