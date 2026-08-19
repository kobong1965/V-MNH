/**
 * videoHelpers.ts
 * 
 * Utility functions for video processing and manipulation.
 * Handles video frame extraction and conversion operations.
 */

/**
 * Extracts the last frame from a video URL as a base64 encoded image
 * 
 * @param videoUrl - URL of the video to extract from (can be data URI or HTTP URL)
 * @returns Promise resolving to base64 encoded PNG image
 * @throws Error if video fails to load or canvas context is unavailable
 * 
 * @example
 * const lastFrame = await extractVideoLastFrame(videoUrl);
 * // Returns: "data:image/png;base64,iVBORw0KGgo..."
 */
export const extractVideoLastFrame = (videoUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.src = videoUrl;

        video.onloadeddata = () => {
            // Seek to last frame once duration is known
            if (video.duration) {
                video.currentTime = video.duration;
            }
        };

        video.onseeked = () => {
            // Create canvas and draw current frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } else {
                reject(new Error('Canvas context unavailable'));
            }
        };

        video.onerror = () => {
            reject(new Error('Video load failed'));
        };
    });
};

export const getVideoFrameSampleTimes = (duration: number, count = 8): number[] => {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const safeCount = Math.max(1, Math.min(12, Math.round(count) || 8));
    return Array.from({ length: safeCount }, (_, index) => {
        const time = ((index + 1) / (safeCount + 1)) * duration;
        return Math.max(0, Math.min(Math.max(0, duration - 0.05), time));
    });
};

interface ExtractVideoFramesOptions {
    count?: number;
    maxEdge?: number;
    quality?: number;
    timeoutMs?: number;
}

/**
 * Evenly samples compressed JPEG frames from a video for multimodal analysis.
 * The whole video remains local; only the returned frames need to be persisted.
 */
export const extractVideoFrames = async (
    videoUrl: string,
    options: ExtractVideoFramesOptions = {}
): Promise<string[]> => {
    const count = Math.max(1, Math.min(12, Math.round(options.count || 8)));
    const maxEdge = Math.max(320, Math.min(1600, Math.round(options.maxEdge || 960)));
    const quality = Math.max(0.45, Math.min(0.9, Number(options.quality) || 0.72));
    const timeoutMs = Math.max(5_000, Math.min(120_000, Math.round(options.timeoutMs || 45_000)));
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const waitForMetadata = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('读取对标视频超时')), timeoutMs);
        video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            resolve();
        };
        video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error('无法读取对标视频，请重新导入视频素材'));
        };
    });

    const seekTo = (time: number) => new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('对标视频抽帧超时')), timeoutMs);
        video.onseeked = () => {
            window.clearTimeout(timer);
            resolve();
        };
        video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error('对标视频抽帧失败'));
        };
        video.currentTime = time;
    });

    try {
        video.src = videoUrl;
        await waitForMetadata;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
            throw new Error('对标视频时长或画面尺寸无效');
        }
        const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('当前设备无法创建视频抽帧画布');

        const frames: string[] = [];
        for (const time of getVideoFrameSampleTimes(video.duration, count)) {
            await seekTo(time);
            context.drawImage(video, 0, 0, width, height);
            frames.push(canvas.toDataURL('image/jpeg', quality));
        }
        return frames;
    } finally {
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
    }
};
