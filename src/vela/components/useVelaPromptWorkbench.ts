import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  analyzeBatchPrompt,
  deletePromptTemplate,
  listPromptTemplates,
  savePromptTemplate,
  type BatchPromptAnalysisResult,
  type PromptTemplate
} from '../services/batchWorkflowService';
import type { VelaProfile } from '../services/profileService';

export interface PromptImageCandidate { file: File; }

interface VisionModelOption {
  key: string;
  profileId: string;
  modelSlot: 'prompt' | 'analysis';
  family: string;
  profileName: string;
  model: string;
}

interface PromptWorkbenchInput {
  resetToken: number;
  prompt: string;
  onPromptChange: (value: string) => void;
  productImages: PromptImageCandidate[];
  benchmarkImage: PromptImageCandidate | null;
  profiles: VelaProfile[];
}

export const MAX_ANALYSIS_IMAGES = 4;
const NON_CHAT_MODEL = /(?:^|[-_.])(image|video|flux|firefly|banana|seedance|minimax-h3)(?:[-_.]|$)/i;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error(`无法读取“${file.name}”`));
  reader.readAsDataURL(file);
});

const modelFamily = (model: string, slot: 'prompt' | 'analysis') => {
  if (/qwen/i.test(model)) return 'Qwen 视觉';
  if (/gpt|o\d/i.test(model)) return 'GPT 视觉';
  return slot === 'analysis' ? '视觉分析' : '提示词视觉';
};

export function useVelaPromptWorkbench({ resetToken, prompt, onPromptChange, productImages, benchmarkImage, profiles }: PromptWorkbenchInput) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [requirement, setRequirement] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [analysis, setAnalysis] = useState<BatchPromptAnalysisResult | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'delete' | 'analyze' | null>('load');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const analysisRevisionRef = useRef(0);

  const modelOptions = useMemo<VisionModelOption[]>(() => profiles.flatMap((profile) => {
    if (profile.type !== 'gpt') return [];
    return (['analysis', 'prompt'] as const).flatMap((modelSlot) => {
      const model = String(profile.models[modelSlot] || '').trim();
      return model && !NON_CHAT_MODEL.test(model) ? [{
        key: `${profile.id}:${modelSlot}`,
        profileId: profile.id,
        modelSlot,
        family: modelFamily(model, modelSlot),
        profileName: profile.name,
        model
      }] : [];
    });
  }), [profiles]);
  const selectedModel = modelOptions.find((option) => option.key === modelKey) || null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;
  const evidenceKey = useMemo(() => [
    ...productImages.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
    benchmarkImage ? `benchmark:${benchmarkImage.file.name}:${benchmarkImage.file.size}:${benchmarkImage.file.lastModified}` : ''
  ].join('|'), [benchmarkImage, productImages]);
  const clearAnalysis = useCallback(() => {
    analysisRevisionRef.current += 1;
    setAnalysis(null);
  }, []);

  useEffect(() => {
    let active = true;
    void listPromptTemplates().then((items) => {
      if (active) setTemplates(items);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '无法读取已保存提示词');
    }).finally(() => {
      if (active) setBusy(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!modelOptions.length) setModelKey('');
    else if (!modelOptions.some((option) => option.key === modelKey)) setModelKey(modelOptions[0].key);
  }, [modelKey, modelOptions]);

  useEffect(() => {
    setSelectedTemplateId('');
    setSaveOpen(false);
    setSaveName('');
    setRequirement('');
    clearAnalysis();
    setNotice('');
    setError('');
  }, [clearAnalysis, resetToken]);
  useEffect(() => { clearAnalysis(); }, [clearAnalysis, evidenceKey]);

  const chooseTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    onPromptChange(template.text);
    clearAnalysis();
    setError('');
    setNotice(`已采用“${template.name}”`);
  };

  const saveCurrent = async () => {
    if (!saveName.trim() || !prompt.trim()) return setError('请填写提示词名称，并确保当前提示词不为空。');
    try {
      setBusy('save');
      setError('');
      const saved = await savePromptTemplate({ name: saveName.trim(), text: prompt.trim() });
      setTemplates((current) => [saved, ...current]);
      setSelectedTemplateId(saved.id);
      setSaveName('');
      setSaveOpen(false);
      setNotice(`已保存“${saved.name}”`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存提示词失败');
    } finally { setBusy(null); }
  };

  const removeSelectedTemplate = async () => {
    if (!selectedTemplate) return;
    try {
      setBusy('delete');
      setError('');
      await deletePromptTemplate(selectedTemplate.id);
      setTemplates((current) => current.filter((item) => item.id !== selectedTemplate.id));
      setSelectedTemplateId('');
      setNotice(`已删除“${selectedTemplate.name}”`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除提示词失败');
    } finally { setBusy(null); }
  };

  const runAnalysis = async () => {
    if (!selectedModel) return setError('请先选择一个 GPT 或 Qwen 视觉模型。');
    if (!productImages.length) return setError('请先在上方添加至少一张产品原图。');
    const analysisRequirement = requirement.trim() || prompt.trim();
    if (!analysisRequirement) return setError('请填写修改需求，或先输入一条基础提示词。');
    const analysisRevision = ++analysisRevisionRef.current;
    try {
      setBusy('analyze');
      setError('');
      setNotice('正在理解产品图和修改需求…');
      const productPayload: Array<{ name: string; data: string }> = [];
      for (const { file } of productImages.slice(0, MAX_ANALYSIS_IMAGES)) {
        productPayload.push({ name: file.name, data: await readFileAsDataUrl(file) });
      }
      const benchmarkPayload = benchmarkImage ? { name: benchmarkImage.file.name, data: await readFileAsDataUrl(benchmarkImage.file) } : null;
      const result = await analyzeBatchPrompt({
        profileId: selectedModel.profileId,
        modelSlot: selectedModel.modelSlot,
        requirement: analysisRequirement,
        productImages: productPayload,
        benchmarkImage: benchmarkPayload
      });
      if (analysisRevision !== analysisRevisionRef.current) return;
      setAnalysis(result);
      setNotice('分析完成，请确认后再采用。');
    } catch (reason) {
      if (analysisRevision !== analysisRevisionRef.current) return;
      setError(reason instanceof Error ? reason.message : 'AI 智能分析失败');
      setNotice('');
    } finally { setBusy(null); }
  };

  const adoptAnalysis = () => {
    if (!analysis?.text.trim()) return;
    onPromptChange(analysis.text.trim());
    setSelectedTemplateId('');
    setNotice('已采用 AI 分析提示词。');
  };

  return {
    adoptAnalysis, analysis, analysisOpen, busy, chooseTemplate, clearAnalysis, error, modelKey, modelOptions,
    notice, removeSelectedTemplate, requirement, runAnalysis, saveCurrent, saveName, saveOpen,
    selectedTemplate, selectedTemplateId, setAnalysisOpen, setError, setModelKey,
    setRequirement, setSaveName, setSaveOpen, setSelectedTemplateId, templates
  };
}
