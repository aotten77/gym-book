import { useEffect, useState } from 'react';
import type { MediaAsset } from '@/domain/models';
import { cn } from '@/lib/utils';

interface ExerciseMediaProps {
  mediaAsset?: MediaAsset;
  blob?: Blob;
  alt: string;
  className?: string;
  imageClassName?: string;
}

export function ExerciseMedia({
  mediaAsset,
  blob,
  alt,
  className,
  imageClassName,
}: ExerciseMediaProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const sourceBlob = blob ?? mediaAsset?.blob;

    if (!sourceBlob) {
      setUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(sourceBlob);
    setUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [blob, mediaAsset?.blob, mediaAsset?.id]);

  if (!url) {
    return null;
  }

  return (
    <div className={cn('overflow-hidden rounded-3xl border border-line bg-surface-raised', className)}>
      <img src={url} alt={alt} className={cn('h-full w-full object-cover', imageClassName)} />
    </div>
  );
}
