// Image loading for the collage renderer. Plain class without Angular.

/** True if the image element has finished loading and has pixels. */
export function isLoaded(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0;
}

/**
 * Loads each photo image once (keyed by photo id) and reports when an image has loaded. Removing
 * an entry (or clearing the cache) stops the load callback of that image.
 */
export class ImageCache {
  private readonly images = new Map<number, HTMLImageElement>();

  constructor(private readonly onLoad: (photoId: number, image: HTMLImageElement) => void) {}

  /** The image element of a photo; starts loading `url` on first use. */
  get(photoId: number, url: string): HTMLImageElement {
    let image = this.images.get(photoId);
    if (!image) {
      const loading = new Image();
      loading.onload = () => this.onLoad(photoId, loading);
      loading.src = url;
      this.images.set(photoId, loading);
      image = loading;
    }
    return image;
  }

  /** Forgets the image of a photo. */
  delete(photoId: number): void {
    const image = this.images.get(photoId);
    if (image) {
      image.onload = null;
      this.images.delete(photoId);
    }
  }

  /** Forgets all images. */
  clear(): void {
    for (const photoId of [...this.images.keys()]) {
      this.delete(photoId);
    }
  }
}
