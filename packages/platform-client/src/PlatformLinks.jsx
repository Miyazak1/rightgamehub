import {createContext,useContext} from 'react';
export const PlatformLinksContext=createContext(null);
export function usePlatformLinks(){return useContext(PlatformLinksContext);}
