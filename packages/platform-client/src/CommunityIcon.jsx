import React from 'react';

const paths={
  home:<><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/></>,
  feed:<><path d="M5 5h14"/><path d="M5 12h14"/><path d="M5 19h9"/><circle cx="3" cy="5" r=".5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".5" fill="currentColor" stroke="none"/><circle cx="3" cy="19" r=".5" fill="currentColor" stroke="none"/></>,
  projects:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  events:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  parties:<><path d="M8 12h8"/><path d="M12 8v8"/><path d="m17 7 1.8.5A4 4 0 0 1 21.5 11l.5 6a3 3 0 0 1-5.4 2l-1.3-2H8.7l-1.3 2A3 3 0 0 1 2 17l.5-6a4 4 0 0 1 2.7-3.5L7 7z"/><circle cx="17" cy="11" r=".75" fill="currentColor" stroke="none"/><circle cx="19" cy="13" r=".75" fill="currentColor" stroke="none"/></>,
  mine:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  plus:<><path d="M12 5v14M5 12h14"/></>,
  edit:<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></>,
  arrowRight:<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  arrowUpRight:<><path d="M7 17 17 7M7 7h10v10"/></>,
  close:<><path d="m6 6 12 12M18 6 6 18"/></>,
};

export default function CommunityIcon({name,size=16,className=''}){
  return <svg className={`community-icon${className?` ${className}`:''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.feed}</svg>;
}
