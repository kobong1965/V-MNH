import { BookmarkPlus, BrainCircuit, Check, ChevronDown, Eye, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { useId } from 'react';

import type { VelaProfile } from '../services/profileService';
import { MAX_ANALYSIS_IMAGES, useVelaPromptWorkbench, type PromptImageCandidate } from './useVelaPromptWorkbench';
import './VelaPromptWorkbench.css';

interface VelaPromptWorkbenchProps {
  resetToken: number;
  prompt: string;
  onPromptChange: (value: string) => void;
  productImages: PromptImageCandidate[];
  benchmarkImage: PromptImageCandidate | null;
  profiles: VelaProfile[];
  onOpenApi: () => void;
}

export function VelaPromptWorkbench(props: VelaPromptWorkbenchProps) {
  const promptId = useId();
  const requirementId = useId();
  const state = useVelaPromptWorkbench(props);
  const { prompt, onPromptChange, productImages, benchmarkImage, onOpenApi } = props;
  const {
    adoptAnalysis, analysis, analysisOpen, busy, chooseTemplate, clearAnalysis, error, modelKey, modelOptions,
    notice, removeSelectedTemplate, requirement, runAnalysis, saveCurrent, saveName, saveOpen,
    selectedTemplate, selectedTemplateId, setAnalysisOpen, setError, setModelKey,
    setRequirement, setSaveName, setSaveOpen, setSelectedTemplateId, templates
  } = state;

  const confirmDeleteTemplate = () => {
    if (!selectedTemplate || !window.confirm(`确认删除提示词“${selectedTemplate.name}”？`)) return;
    void removeSelectedTemplate();
  };

  return (
    <div className="vela-prompt-workbench">
      <div className="vela-prompt-workbench__label-row">
        <label htmlFor={promptId}>图生图节点提示词</label>
        <div className="vela-prompt-workbench__library">
          <select aria-label="选择已保存提示词" value={selectedTemplateId} onChange={(event) => chooseTemplate(event.target.value)} disabled={Boolean(busy)}>
            <option value="">{busy === 'load' ? '正在读取提示词…' : templates.length ? '选择已保存提示词' : '暂无已保存提示词'}</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <button type="button" onClick={() => { setSaveOpen(!saveOpen); setError(''); }} disabled={Boolean(busy)}><BookmarkPlus size={14} />保存当前</button>
          <button type="button" className="vela-prompt-workbench__icon-button" onClick={confirmDeleteTemplate} disabled={!selectedTemplateId || Boolean(busy)} aria-label="删除选择的提示词"><Trash2 size={14} /></button>
        </div>
      </div>

      {saveOpen && <div className="vela-prompt-workbench__save-row">
        <input aria-label="提示词名称" maxLength={80} value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="给这条提示词起个名字" />
        <button type="button" onClick={() => void saveCurrent()} disabled={busy === 'save' || !saveName.trim() || !prompt.trim()}>{busy === 'save' ? <Loader2 className="vela-spin" size={14} /> : <Check size={14} />}保存</button>
        <button type="button" className="vela-prompt-workbench__icon-button" onClick={() => setSaveOpen(false)} aria-label="取消保存"><X size={14} /></button>
      </div>}

      <textarea id={promptId} value={prompt} maxLength={4000} disabled={busy === 'analyze'} onChange={(event) => { onPromptChange(event.target.value); setSelectedTemplateId(''); clearAnalysis(); }} />

      <section className="vela-prompt-workbench__analyst" aria-label="AI 智能分析提示词" data-open={analysisOpen}>
        <header>
          <div><BrainCircuit size={18} aria-hidden="true" /><span><strong>AI 智能分析提示词</strong><small>结合需求、产品图和对标图理解后再写提示词</small></span></div>
          <button type="button" aria-expanded={analysisOpen} onClick={() => setAnalysisOpen(!analysisOpen)}>{analysisOpen ? '收起' : '展开'}<ChevronDown size={15} /></button>
        </header>
        {analysisOpen && <div className="vela-prompt-workbench__analyst-body">
          <div className="vela-prompt-workbench__analysis-grid">
            <label><span>视觉 AI 模型</span><select value={modelKey} disabled={busy === 'analyze'} onChange={(event) => { setModelKey(event.target.value); clearAnalysis(); }}><option value="">请选择视觉模型</option>{modelOptions.map((option) => <option key={option.key} value={option.key}>{option.family} · {option.profileName} · {option.model}</option>)}</select></label>
            <label htmlFor={requirementId}><span>你希望怎么修改</span><textarea id={requirementId} value={requirement} maxLength={4000} disabled={busy === 'analyze'} onChange={(event) => { setRequirement(event.target.value); clearAnalysis(); }} placeholder="例如：识别裤子的现有版型，只把颜色换成纯黑；人物、上衣、鞋子、姿势和背景完全不变。留空时使用上面的当前提示词。" /></label>
          </div>
          <div className="vela-prompt-workbench__evidence">
            <span><Eye size={14} />将分析 {Math.min(productImages.length, MAX_ANALYSIS_IMAGES)} 张产品图{benchmarkImage ? ' + 1 张对标图' : ''}</span>
            {productImages.length > MAX_ANALYSIS_IMAGES && <small>为保证判断清晰，本次只取前 {MAX_ANALYSIS_IMAGES} 张</small>}
            {modelOptions.length ? <button type="button" onClick={() => void runAnalysis()} disabled={busy === 'analyze' || !productImages.length}>{busy === 'analyze' ? <Loader2 className="vela-spin" size={15} /> : <Sparkles size={15} />}分析产品图</button> : <button type="button" onClick={onOpenApi}>去 API 页面配置 GPT / Qwen</button>}
          </div>
        </div>}
      </section>

      {(error || notice) && <p className="vela-prompt-workbench__feedback" data-error={Boolean(error)} role={error ? 'alert' : 'status'}>{error || notice}</p>}
      {analysis && <section className="vela-prompt-workbench__preview" aria-label="AI 分析提示词预览">
        <header><div><Sparkles size={15} /><strong>分析预览</strong><span>{analysis.source.model}</span></div><button type="button" onClick={clearAnalysis} aria-label="关闭分析预览"><X size={14} /></button></header>
        <p>{analysis.text}</p>
        <footer><span>当前提示词尚未改变</span><button type="button" onClick={adoptAnalysis}><Check size={15} />采用这条提示词</button></footer>
      </section>}
    </div>
  );
}
