type FsckThreads_t = { fetchThread? : (string, string) => Promise<[Array<Uint8Array>, Error | undefined]>}
interface GoLauncher { }
declare global {
    export interface Window {
      Go: unknown;
      FsckThreads : FsckThreads_t
      myGolangFunction: (num1: number, num2: number) => number
    }
  }
  
  export {};
  