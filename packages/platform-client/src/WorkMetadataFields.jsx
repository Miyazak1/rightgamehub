import React from 'react';
import { workKindLabels } from './work-metadata.mjs';
export default function WorkMetadataFields({ form, onChange, kind, onKindChange }) {
  return <>
    <label>作品名称<input required aria-label="作品名称" name="title" maxLength="120" value={form.title} onChange={onChange}/></label>
    <div className="form-grid"><label>作品类型{onKindChange ? <select aria-label="作品类型" name="kind" value={kind} onChange={onKindChange}>{Object.entries(workKindLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select> : <input aria-label="作品类型" readOnly value={workKindLabels[kind] || kind}/>}</label><label>预计时长（分钟）<input aria-label="预计时长（分钟）" name="estimatedMinutes" required type="number" min="1" max="30" step="1" value={form.estimatedMinutes} onChange={onChange}/></label></div>
    <label>一句话介绍<textarea required aria-label="一句话介绍" name="description" maxLength="4000" value={form.description} onChange={onChange}/></label>
    <label>玩法说明<textarea aria-label="玩法说明" name="instructions" maxLength="4000" value={form.instructions} onChange={onChange}/></label>
    <label>发现标签<input aria-label="发现标签" name="tags" value={form.tags} onChange={onChange} placeholder="解谜，静音友好，像素（最多 6 个）"/></label>
    <label>使用的 Coding Agent<input aria-label="使用的 Coding Agent" name="agentLabel" maxLength="40" list="work-agent-options" value={form.agentLabel} onChange={onChange} placeholder="可选，例如 Codex 或 Cursor"/><datalist id="work-agent-options">{['Codex','Cursor','Claude Code','GitHub Copilot','其他'].map(label => <option key={label} value={label}/>)}</datalist></label>
    <fieldset className="open-source-fields"><legend>开源项目（可选）</legend><label>GitHub 仓库<input type="url" aria-label="GitHub 仓库" name="repositoryUrl" value={form.repositoryUrl} onChange={onChange} pattern="https://github\.com/[^/\s]+/[^/\s]+/?" placeholder="https://github.com/you/project"/></label><label>开源许可证<input aria-label="开源许可证" name="licenseSpdx" maxLength="40" value={form.licenseSpdx} onChange={onChange} placeholder="MIT / Apache-2.0"/></label><small>两项需同时填写，也可以同时清空。此处修改展示资料，不会切换 GitHub 导入的源码来源。</small></fieldset>
  </>;
}
