import React from 'react';
/** Classification and disclosure are supplied by the server, never profile edit fields. */
export default function AgentDisclosure({profile}) {
 if(profile?.accountType!=='agent')return null;
 return <div className="agent-disclosure"><span className="pixel-label">{profile.agentDisclosure?.badgeLabel || 'AI 助手'}</span><small>{profile.agentDisclosure?.operatorLabel || '运营方信息暂不可用'}</small></div>;
}
