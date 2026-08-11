import { Film, Image as ImageIcon, Images, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';

export interface VelaGeneratedAsset {
  id: string;
  type: 'image' | 'video';
  url: string;
  title: string;
  prompt?: string;
  model?: string;
}

interface VelaAssetTrayProps {
  isOpen: boolean;
  assets: VelaGeneratedAsset[];
  onClose: () => void;
  onInsert: (asset: VelaGeneratedAsset) => void;
}

type AssetFilter = 'all' | 'image' | 'video';

export function VelaAssetTray({ isOpen, assets, onClose, onInsert }: VelaAssetTrayProps) {
  const [filter, setFilter] = useState<AssetFilter>('all');
  const filteredAssets = useMemo(
    () => filter === 'all' ? assets : assets.filter((asset) => asset.type === filter),
    [assets, filter]
  );

  if (!isOpen) return null;

  return (
    <aside className="vela-asset-tray vela-panel" aria-label="素材盘" onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <span><Images size={16} aria-hidden="true" />素材盘</span>
        <button type="button" onClick={onClose} aria-label="关闭素材盘"><X size={16} /></button>
      </header>
      <p>当前项目生成成功的图片和视频会自动保存到这里。</p>
      <div className="vela-asset-tray__filters" role="tablist" aria-label="素材类型">
        <button type="button" role="tab" aria-selected={filter === 'all'} data-active={filter === 'all' || undefined} onClick={() => setFilter('all')}>全部 {assets.length}</button>
        <button type="button" role="tab" aria-selected={filter === 'image'} data-active={filter === 'image' || undefined} onClick={() => setFilter('image')}>图片</button>
        <button type="button" role="tab" aria-selected={filter === 'video'} data-active={filter === 'video' || undefined} onClick={() => setFilter('video')}>视频</button>
      </div>
      <div className="vela-asset-tray__grid">
        {filteredAssets.length === 0 ? (
          <div className="vela-asset-tray__empty">
            <Images size={28} strokeWidth={1.4} aria-hidden="true" />
            <strong>还没有生成素材</strong>
            <span>生成成功后会自动出现在这里。</span>
          </div>
        ) : filteredAssets.map((asset) => (
          <article key={`${asset.id}:${asset.url}`}>
            <button type="button" className="vela-asset-tray__preview" onClick={() => onInsert(asset)} aria-label={`把 ${asset.title} 添加到画布`}>
              {asset.type === 'video' ? (
                <video src={asset.url} muted preload="metadata" />
              ) : (
                <img src={asset.url} alt="" />
              )}
              <span className="vela-asset-tray__kind">{asset.type === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}{asset.type === 'video' ? '视频' : '图片'}</span>
              <span className="vela-asset-tray__insert"><Plus size={13} />添加到画布</span>
            </button>
            <div><strong>{asset.title}</strong><span>{asset.model || '生成素材'}</span></div>
          </article>
        ))}
      </div>
    </aside>
  );
}
