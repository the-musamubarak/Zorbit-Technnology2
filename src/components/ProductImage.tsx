import { ImageIcon } from "lucide-react";

// Offline change: images no longer live in Supabase Storage with signed
// URLs. Product photos are converted to a data URL in the browser at upload
// time (see products.tsx) and stored directly in the `image_url` column, so
// this component just renders it — no async lookup needed.
export function ProductImage({
  path,
  alt,
  className = "h-40 w-full",
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!path) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <ImageIcon className="h-7 w-7 text-muted-foreground" aria-hidden />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }

  return <img src={path} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}
