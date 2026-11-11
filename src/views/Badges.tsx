import type { Summary } from "@/lib/types";
import { evaluateTracks, globalRank } from "@/lib/badges";
import { Panel, Metadata } from "@/components/Primitives";
export function Badges({ full }: { full: Summary }) {
  const tracks = evaluateTracks(full),
    rank = globalRank(tracks);
  const remaining = rank.atNext === null ? 0 : rank.atNext - rank.totalLevels;
  return (
    <div className="view-stack">
      <Panel title={rank.rank} hint="All recorded history" className="rank-panel">
        <Metadata
          items={[
            { label: "Levels", value: rank.totalLevels },
            { label: "Tracks", value: rank.trackCount }
          ]}
        />
        <progress max="1" value={rank.progress} />
        <p className="note">
          {rank.nextRank
            ? `${remaining} ${remaining === 1 ? "level" : "levels"} to ${rank.nextRank}`
            : "Highest rank reached"}
        </p>
      </Panel>
      <div className="three-columns">
        {tracks.map((track) => (
          <Panel key={track.id} title={track.name} hint={`Level ${track.level}`}>
            <div className="badge-value" style={{ color: track.tint }}>
              {track.valueText}
            </div>
            <p className="note">{track.tierLabel}</p>
            <progress max="1" value={track.progress} />
            <p className="note">Next milestone: {track.nextText}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
