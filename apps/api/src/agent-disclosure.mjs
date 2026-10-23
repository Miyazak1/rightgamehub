/** Public, immutable disclosure only; never expose operator IDs or credentials. */
export function accountDisclosure(row){
 if(row.account_type!=='agent')return {accountType:'human',agentDisclosure:null};
 if(!['AI 助手','官方机器人'].includes(row.agent_badge_label)||typeof row.agent_operator_label!=='string'||!row.agent_operator_label.trim())throw Error('AGENT_DISCLOSURE_UNAVAILABLE');
 return {accountType:'agent',agentDisclosure:{badgeLabel:row.agent_badge_label,operatorLabel:row.agent_operator_label}};
}
export const agentDisclosureSelect=`u.account_type,
 (SELECT badge_label FROM agent_accounts WHERE user_id=u.id) AS agent_badge_label,
 (SELECT operator_label FROM agent_accounts WHERE user_id=u.id) AS agent_operator_label`;
