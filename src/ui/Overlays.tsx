import type { DrillResult, RaceResult } from '../game/game';
import { formatLapTime } from '../sim/math';
import { trackById } from '../sim/tracks';
import { useI18n } from './i18n';
import { Icon } from './icons';

export function Loading({ error, progress }: { error: string | null; progress: string }) {
  const { t } = useI18n();
  return (
    <div className="loading">
      <div className="loading-card">
        <Icon name="drone" size={56} />
        <h1>{t('app.title')}</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button className="btn primary" onClick={() => window.location.reload()}>
              {t('loading.retry')}
            </button>
          </>
        ) : (
          <>
            <p>{t('loading.title')}</p>
            <div className="spinner" />
            <p className="muted small">{progress || t('loading.hint')}</p>
          </>
        )}
      </div>
    </div>
  );
}

interface PauseProps {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSettings: () => void;
}

export function PauseMenu({ onResume, onRestart, onMenu, onSettings }: PauseProps) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop">
      <div className="modal pause" role="dialog" aria-label={t('pause.title')}>
        <h2>{t('pause.title')}</h2>
        <button className="btn primary big" onClick={onResume}>
          <Icon name="play" /> {t('pause.resume')}
        </button>
        <button className="btn big" onClick={onRestart}>
          <Icon name="reset" /> {t('pause.restart')}
        </button>
        <button className="btn big" onClick={onSettings}>
          <Icon name="settings" /> {t('pause.settings')}
        </button>
        <button className="btn big" onClick={onMenu}>
          <Icon name="back" /> {t('pause.menu')}
        </button>
      </div>
    </div>
  );
}

interface ResultsProps {
  result: RaceResult | DrillResult;
  onAgain: () => void;
  onMenu: () => void;
}

export function Results({ result, onAgain, onMenu }: ResultsProps) {
  const { t, lang } = useI18n();
  return (
    <div className="modal-backdrop">
      <div className="modal results" role="dialog">
        {result.kind === 'race' ? (
          <>
            <p className="muted">{trackById(result.track).name[lang]}</p>
            <h2>{t('results.race')}</h2>
            {result.newRecord && (
              <p className="record">
                <Icon name="trophy" /> {t('results.newRecord')}
              </p>
            )}
            <div className="result-big">
              <span>{t('results.total')}</span>
              <b>{formatLapTime(result.total)}</b>
            </div>
            <ol className="lap-list">
              {result.laps.map((l, i) => (
                <li key={i} className={l === result.bestLap ? 'best' : ''}>
                  <span>{t('results.lap', { n: i + 1 })}</span>
                  <b>{formatLapTime(l)}</b>
                </li>
              ))}
            </ol>
            {result.recordLap !== null && <p className="muted small">{t('results.previous', { time: formatLapTime(result.recordLap) })}</p>}
          </>
        ) : (
          <>
            <p className="muted">{t(`drill.${result.drill}`)}</p>
            <h2>{t('results.drill')}</h2>
            <div className="stars" aria-label={`${result.score}/3`}>
              {[1, 2, 3].map((n) => (
                <span key={n} className={n <= result.score ? 'star on' : 'star'}>
                  ★
                </span>
              ))}
            </div>
            <div className="result-big">
              <span>{t('results.time')}</span>
              <b>{formatLapTime(result.time)}</b>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn primary big" onClick={onAgain}>
            <Icon name="reset" /> {t('results.again')}
          </button>
          <button className="btn big" onClick={onMenu}>
            <Icon name="back" /> {t('results.menu')}
          </button>
        </div>
      </div>
    </div>
  );
}
