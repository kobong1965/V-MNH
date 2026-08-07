import React, { useEffect, useMemo, useState } from 'react';
import { Film, Image as ImageIcon, Trash2, X } from 'lucide-react';

interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
}

interface AssetLibraryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (url: string, type: 'image' | 'video') => void;
    panelY?: number;
    variant?: 'panel' | 'modal';
    canvasTheme?: 'dark' | 'light';
}

const CATEGORIES = [
    { value: 'All', label: '全部' },
    { value: 'Character', label: '角色' },
    { value: 'Scene', label: '场景' },
    { value: 'Item', label: '商品' },
    { value: 'Style', label: '风格' },
    { value: 'Sound Effect', label: '音效' },
    { value: 'Others', label: '其他' }
] as const;

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset
}) => {
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedMedia, setSelectedMedia] = useState<'all' | 'image' | 'video'>('all');
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let disposed = false;
        setLoading(true);
        fetch('/api/library')
            .then(async (response) => response.ok ? response.json() : [])
            .then((items) => { if (!disposed) setAssets(Array.isArray(items) ? items : []); })
            .catch((error) => console.error('素材库加载失败:', error))
            .finally(() => { if (!disposed) setLoading(false); });
        return () => { disposed = true; };
    }, [isOpen]);

    const counts = useMemo(() => ({
        image: assets.filter((asset) => asset.type === 'image').length,
        video: assets.filter((asset) => asset.type === 'video').length
    }), [assets]);

    const filteredAssets = useMemo(() => assets.filter((asset) => {
        const categoryMatches = selectedCategory === 'All' || asset.category === selectedCategory;
        const mediaMatches = selectedMedia === 'all' || asset.type === selectedMedia;
        return categoryMatches && mediaMatches;
    }), [assets, selectedCategory, selectedMedia]);

    const deleteAsset = async (id: string) => {
        try {
            const response = await fetch(`/api/library/${id}`, { method: 'DELETE' });
            if (response.ok) setAssets((current) => current.filter((asset) => asset.id !== id));
        } catch (error) {
            console.error('素材删除失败:', error);
        } finally {
            setDeleteConfirmId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="vela-asset-backdrop" role="presentation" onMouseDown={onClose}>
            <section className="vela-asset-modal" role="dialog" aria-modal="true" aria-label="历史资产" onMouseDown={(event) => event.stopPropagation()}>
                <header className="vela-asset-header">
                    <h2>历史资产</h2>
                    <button className="vela-asset-close" type="button" onClick={onClose} aria-label="关闭素材库"><X size={21} /></button>
                </header>

                <div className="vela-asset-toolbar">
                    <nav className="vela-asset-tabs" aria-label="素材类型">
                        <button type="button" data-active={selectedMedia === 'all' || undefined} onClick={() => setSelectedMedia('all')}>全部资产 ({assets.length})</button>
                        <button type="button" data-active={selectedMedia === 'image' || undefined} onClick={() => setSelectedMedia('image')}>图片历史 ({counts.image})</button>
                        <button type="button" data-active={selectedMedia === 'video' || undefined} onClick={() => setSelectedMedia('video')}>视频历史 ({counts.video})</button>
                    </nav>
                    <label className="vela-asset-category-label">
                        <span>分类</span>
                        <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                            {CATEGORIES.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}
                        </select>
                    </label>
                </div>

                <div className="vela-asset-content">
                    {loading ? (
                        <div className="vela-asset-empty" role="status">正在加载本地资产…</div>
                    ) : filteredAssets.length === 0 ? (
                        <div className="vela-asset-empty" role="status">
                            <div className="vela-asset-empty-icon">{selectedMedia === 'video' ? <Film size={28} /> : <ImageIcon size={28} />}</div>
                            <strong>还没有这类资产</strong>
                            <span>生成结果或上传素材后，会按时间保存在这里。</span>
                        </div>
                    ) : (
                        <div className="vela-asset-grid">
                            {filteredAssets.map((asset) => (
                                <article className="vela-asset-card" key={asset.id}>
                                    <button className="vela-asset-preview" type="button" onClick={() => onSelectAsset(asset.url, asset.type)}>
                                        {asset.type === 'video'
                                            ? <video src={asset.url} muted preload="metadata" />
                                            : <img src={asset.url} alt={asset.name} />}
                                        <span>{asset.type === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}{asset.name}</span>
                                    </button>
                                    {deleteConfirmId === asset.id ? (
                                        <div className="vela-asset-delete-confirm">
                                            <button type="button" onClick={() => void deleteAsset(asset.id)}>确认删除</button>
                                            <button type="button" onClick={() => setDeleteConfirmId(null)}>取消</button>
                                        </div>
                                    ) : (
                                        <button className="vela-asset-delete" type="button" onClick={() => setDeleteConfirmId(asset.id)} aria-label={`删除 ${asset.name}`}><Trash2 size={14} /></button>
                                    )}
                                </article>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};
