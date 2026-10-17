import { Icon } from "./Icon";
import styles from "./NowPlaying.module.css";

export interface NowPlayingInfo {
  app: string;
  title: string | null;
  artist: string | null;
}

/**
 * Frosted-glass now-playing card (ref: blue glassmorphism music app): tilted glass art tile,
 * italic display title, circular play button. Used in 桌面模式 scenes and the panel.
 */
export function NowPlaying({ music, compact = false, onLight = false, className = "" }: { music: NowPlayingInfo; compact?: boolean; onLight?: boolean; className?: string }) {
  const title = music.title ?? "正在播放";
  return (
    <div className={`${styles.card} ${compact ? styles.compact : ""} ${onLight ? styles.onLight : ""} ${className}`}>
      <div className={styles.art} aria-hidden>
        <Icon name="music" className={styles.note} />
      </div>
      <div className={styles.meta}>
        <div className={styles.kicker}>Now Playing · {music.app}</div>
        <div className={styles.title} title={title}>
          {title}
        </div>
        {music.artist && <div className={styles.artist}>{music.artist}</div>}
        <div className={styles.bar} aria-hidden>
          <i />
        </div>
      </div>
      <div className={styles.play} aria-hidden>
        <svg viewBox="0 0 24 24">
          <rect x="7" y="6" width="3.4" height="12" rx="1.2" />
          <rect x="13.6" y="6" width="3.4" height="12" rx="1.2" />
        </svg>
      </div>
    </div>
  );
}
