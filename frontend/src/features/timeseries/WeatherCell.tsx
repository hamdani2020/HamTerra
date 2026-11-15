import { VerbatimText } from "@/components/common/VerbatimText";
import { formatDate } from "@/lib/format";
import { TIME_SERIES_TEXT } from "@/lib/messages";
import type { WeatherContext } from "@/types/api";

/**
 * Weather values with units, the provider, the period and the Backend note, unchanged
 * (Requirements 10.16, 20.4). Context only: nothing links it to the NDVI value.
 */
export function WeatherCell({ weather }: { weather: WeatherContext }): JSX.Element {
  const entries = Object.entries(weather.values);
  return (
    <div className="space-y-1 text-sm">
      {entries.length > 0 && (
        <ul className="space-y-0.5">
          {entries.map(([name, value]) => (
            <li key={name}>
              <span className="text-ink-muted">{name}:</span>{" "}
              <span className="tabular-nums text-foreground">
                {value.value} {value.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted">
        {TIME_SERIES_TEXT.weatherProvider}: <VerbatimText as="span" text={weather.provider} />
      </p>
      <p className="text-ink-muted">
        {TIME_SERIES_TEXT.weatherPeriod}: {formatDate(weather.period.from)} – {formatDate(weather.period.to)}
      </p>
      <VerbatimText text={weather.note} className="text-ink-muted" />
    </div>
  );
}
