import { useEffect, useState } from 'react';
import { MAX_PHOTOS_PER_VISIT, MAX_UPLOAD_BYTES } from '@kroegentocht/shared';

/**
 * Fotos kiezen of maken.
 *
 * capture="environment" laat een telefoon meteen de camera aan de achterkant
 * openen. De bestanden blijven als Blob in het geheugen en gaan via de offline
 * wachtrij naar de server; daar worden ze hergecodeerd en van hun EXIF gestript.
 *
 * De grootte wordt hier al gecontroleerd, zodat iemand niet eerst een minuut
 * wacht om daarna een 413 te krijgen. De server controleert het opnieuw, want
 * een controle in de browser is een gebruiksgemak en geen beveiliging.
 */
export function PhotoPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const add = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted: File[] = [...files];
    let rejected: string | null = null;

    for (const file of Array.from(incoming)) {
      if (accepted.length >= MAX_PHOTOS_PER_VISIT) {
        rejected = `Maximaal ${MAX_PHOTOS_PER_VISIT} fotos per bezoek.`;
        break;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected = `${file.name} is groter dan ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
        continue;
      }
      accepted.push(file);
    }

    setProblem(rejected);
    onChange(accepted);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {previews.map((url, index) => (
          <div key={url} className="relative">
            <img
              src={url}
              alt={`Foto ${index + 1}`}
              className="size-20 rounded-lg border border-line object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(files.filter((_, i) => i !== index))}
              className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-surface text-sm text-ink shadow-card ring-1 ring-line hover:bg-coral hover:text-white"
              aria-label={`Foto ${index + 1} verwijderen`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {/* Een label om een verborgen input is genoeg: een klik op het label
            opent de bestandskiezer, en het toetsenbord werkt ook. */}
        <label className="cursor-pointer rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink hover:bg-amber-hover">
          Foto maken
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
        </label>

        <label className="cursor-pointer rounded-lg bg-canvas px-4 py-2 text-sm hover:bg-line">
          Uit galerij kiezen
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {problem ? <p className="mt-2 text-sm text-coral-ink">{problem}</p> : null}
      <p className="mt-2 text-xs text-ink-soft">
        Locatiegegevens en andere metadata worden bij het uploaden verwijderd. Elke foto wordt
        opnieuw opgeslagen als webp.
      </p>
    </div>
  );
}
