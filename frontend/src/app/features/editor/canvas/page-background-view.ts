// Konva nodes of the page background. Plain class without Angular; used by `CollageRenderer` and the export.
import Konva from 'konva/lib/Core';
import { Image as KonvaImage } from 'konva/lib/shapes/Image';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { GradientSettings, PageSize } from '../../../core/models/collage';
import type { NormalizedRect } from '../../../core/models/photo';
import { coverCrop, imageAspect } from '../geometry/crop';
import { linearGradientLine, radialGradientCircle } from '../geometry/gradient';
import type { ImageSize } from '../geometry/transform';
import { blurredImage } from './blurred-image';
import { isLoaded } from './image-cache';
import type { SceneBackground } from './scene';

/**
 * The Konva nodes of the page background: a group (not listening) that covers the page. From
 * bottom to top: the solid colour rect (always), the gradient rect (type `gradient`), the bg photo
 * (type `image`, cover crop, centred; only once its image has loaded; with `blurMm` > 0 a blurred
 * copy of the crop) and the overlay rect (type `image`, overlay colour with its opacity; hidden at
 * 0 %). World units are mm, page origin top-left.
 */
export class PageBackgroundView {
  readonly group = new Konva.Group({ listening: false });
  private readonly colorRect = new KonvaRect({ x: 0, y: 0 });
  private readonly gradientRect = new KonvaRect({ x: 0, y: 0, visible: false });
  private readonly image = new KonvaImage({
    x: 0,
    y: 0,
    image: undefined,
    visible: false,
    perfectDrawEnabled: false,
  });
  private readonly overlayRect = new KonvaRect({ x: 0, y: 0, visible: false });
  private source: HTMLImageElement | null = null;
  private page: PageSize | null = null;
  private background: SceneBackground | null = null;
  /** Last blurred copy and what it was built from; rebuilt only when one of these changes. */
  private blurred: {
    source: HTMLImageElement;
    widthMm: number;
    heightMm: number;
    blurMm: number;
    canvas: HTMLCanvasElement;
  } | null = null;

  constructor() {
    this.group.add(this.colorRect, this.gradientRect, this.image, this.overlayRect);
  }

  /** Draws the background of the scene over the whole page. */
  update(page: PageSize, background: SceneBackground): void {
    this.page = page;
    this.background = background;
    this.colorRect.setAttrs({
      width: page.widthMm,
      height: page.heightMm,
      fill: background.color,
    });
    const showGradient = background.type === 'gradient';
    this.gradientRect.visible(showGradient);
    if (showGradient) {
      this.updateGradient(page, background.gradient);
    }
    this.updateOverlay(page, background);
    this.applyImage();
  }

  /**
   * Sets the source image of the bg photo (`null`: none). It is drawn once it has loaded and the
   * type is `image` with an `imageFile`; call again after the load to show it.
   */
  setImage(image: HTMLImageElement | null): void {
    this.source = image;
    this.applyImage();
  }

  /** Overlay rect for the type `image`: overlay colour with opacity percent / 100, hidden at 0. */
  private updateOverlay(page: PageSize, background: SceneBackground): void {
    const { overlayColor, overlayOpacityPercent } = background.image;
    const opacity = overlayOpacityPercent / 100;
    const showOverlay = background.type === 'image' && opacity > 0;
    this.overlayRect.visible(showOverlay);
    if (showOverlay) {
      this.overlayRect.setAttrs({
        width: page.widthMm,
        height: page.heightMm,
        fill: overlayColor,
        opacity,
      });
    }
  }

  /** Shows the loaded source image cropped to cover the page (centred), or hides the image node. */
  private applyImage(): void {
    const image = this.source && isLoaded(this.source) ? this.source : null;
    const file = this.background?.type === 'image' ? this.background.imageFile : undefined;
    const page = this.page;
    const show = image !== null && file !== undefined && page !== null;
    this.image.visible(show);
    if (show) {
      this.drawImage(image, file.image, page, this.background?.image.blurMm ?? 0);
    } else {
      this.image.image(undefined);
      this.blurred = null;
    }
  }

  /**
   * Sizes the image node to the page and draws the cover crop (normalized → source pixels), or the
   * blurred copy of the crop (no node crop, the copy is the crop) if `blurMm` > 0.
   */
  private drawImage(
    image: HTMLImageElement,
    size: ImageSize,
    page: PageSize,
    blurMm: number,
  ): void {
    const crop = coverCrop(
      imageAspect(size.widthPx, size.heightPx),
      imageAspect(page.widthMm, page.heightMm),
    );
    this.image.size({ width: page.widthMm, height: page.heightMm });
    if (blurMm > 0) {
      this.image.image(this.blurredCopy(image, crop, page, blurMm));
      this.image.crop({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    this.blurred = null;
    this.image.image(image);
    this.image.crop({
      x: crop.x * image.naturalWidth,
      y: crop.y * image.naturalHeight,
      width: crop.width * image.naturalWidth,
      height: crop.height * image.naturalHeight,
    });
  }

  /** The blurred copy of the crop; reuses the last one while image, page size and radius stay. */
  private blurredCopy(
    image: HTMLImageElement,
    crop: NormalizedRect,
    page: PageSize,
    blurMm: number,
  ): HTMLCanvasElement {
    const last = this.blurred;
    if (
      last?.source === image &&
      last.widthMm === page.widthMm &&
      last.heightMm === page.heightMm &&
      last.blurMm === blurMm
    ) {
      return last.canvas;
    }
    const canvas = blurredImage(image, crop, page, blurMm);
    this.blurred = {
      source: image,
      widthMm: page.widthMm,
      heightMm: page.heightMm,
      blurMm,
      canvas,
    };
    return canvas;
  }

  /** Sets the gradient fill of the gradient rect (linear or radial, colour stops From → To). */
  private updateGradient(page: PageSize, gradient: GradientSettings): void {
    const colorStops = [0, gradient.from, 1, gradient.to];
    this.gradientRect.setAttrs({ width: page.widthMm, height: page.heightMm });
    if (gradient.kind === 'radial') {
      const { center, radius } = radialGradientCircle(page);
      this.gradientRect.setAttrs({
        fillPriority: 'radial-gradient',
        fillRadialGradientStartPoint: center,
        fillRadialGradientEndPoint: center,
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndRadius: radius,
        fillRadialGradientColorStops: colorStops,
      });
    } else {
      const { start, end } = linearGradientLine(page, gradient.angleDeg);
      this.gradientRect.setAttrs({
        fillPriority: 'linear-gradient',
        fillLinearGradientStartPoint: start,
        fillLinearGradientEndPoint: end,
        fillLinearGradientColorStops: colorStops,
      });
    }
  }
}
