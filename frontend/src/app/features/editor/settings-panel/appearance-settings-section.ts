import { Component, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import {
  BackgroundSettings,
  BorderSettings,
  defaultCollageSettings,
  GradientSettings,
  ImageBackgroundSettings,
} from '../../../core/models/collage';
import type { Shadow } from '../../../core/models/shadow';
import { limitValidators } from '../../../shared/number-limits';
import { BORDER_WIDTH_LIMITS, BorderFields } from '../fields/border-fields';
import { ColorField } from '../fields/color-field';
import { NumberField } from '../fields/number-field';
import {
  shadowFormGroup,
  ShadowFields,
  shadowFromFormValue,
  toShadowFormValue,
} from '../fields/shadow-fields';
import { syncFromInput } from '../fields/sync-from-input';
import { SETTINGS_LIMITS } from './settings-limits';

/**
 * Page background (type with its fields), default photo border and default photo shadow, each
 * with "Apply to all photos" (removes the borders or shadows of single photos). Emits each valid change, and a preview
 * while a background, border or shadow colour is changed in a picker.
 */
@Component({
  selector: 'app-appearance-settings-section',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSliderModule,
    BorderFields,
    ColorField,
    NumberField,
    ShadowFields,
  ],
  template: `
    @let bg = form.controls.background.controls;
    @let gradient = bg.gradient.controls;
    <mat-form-field subscriptSizing="dynamic">
      <mat-label i18n="@@editor.settings.backgroundType">Background</mat-label>
      <mat-select [formControl]="bg.type" (selectionChange)="commitBackground()">
        <mat-option value="color" i18n="@@editor.settings.backgroundTypeColor">Colour</mat-option>
        <mat-option value="gradient" i18n="@@editor.settings.backgroundTypeGradient">
          Gradient
        </mat-option>
        <mat-option value="image" i18n="@@editor.settings.backgroundTypeImage">Image</mat-option>
      </mat-select>
    </mat-form-field>
    @switch (selectedType()) {
      @case ('color') {
        <app-color-field
          [control]="bg.color"
          i18n-label="@@editor.settings.backgroundColor"
          label="Background colour"
          (previewed)="previewBackground({ color: $event })"
          (committed)="commitBackground()"
        />
      }
      @case ('gradient') {
        <mat-form-field subscriptSizing="dynamic">
          <mat-label i18n="@@editor.settings.gradientKind">Gradient</mat-label>
          <mat-select [formControl]="gradient.kind" (selectionChange)="commitBackground()">
            <mat-option value="linear" i18n="@@editor.settings.gradientKindLinear">
              Linear
            </mat-option>
            <mat-option value="radial" i18n="@@editor.settings.gradientKindRadial">
              Radial
            </mat-option>
          </mat-select>
        </mat-form-field>
        <div class="field-row">
          <app-color-field
            [control]="gradient.from"
            i18n-label="@@editor.settings.gradientFrom"
            label="From"
            (previewed)="previewGradient({ from: $event })"
            (committed)="commitBackground()"
          />
          <app-color-field
            [control]="gradient.to"
            i18n-label="@@editor.settings.gradientTo"
            label="To"
            (previewed)="previewGradient({ to: $event })"
            (committed)="commitBackground()"
          />
        </div>
        @if (selectedGradientKind() === 'linear') {
          <app-number-field
            [control]="gradient.angleDeg"
            [limits]="limits.gradientAngleDeg"
            i18n-label="@@editor.settings.gradientAngleDeg"
            label="Angle (°)"
            (committed)="commitBackground()"
          />
        }
      }
      @case ('image') {
        @if (backgroundImageUrl(); as url) {
          <div class="background-image-row">
            <img class="background-thumbnail" [src]="url" alt="" />
            <button matButton="outlined" type="button" (click)="removeImage()">
              <mat-icon>hide_image</mat-icon>
              <span i18n="@@editor.settings.backgroundImageRemove">Remove image</span>
            </button>
          </div>
        } @else {
          <p class="settings-note" i18n="@@editor.settings.backgroundImageHint">
            Select a photo on the page and click "Use as background".
          </p>
        }
        <app-color-field
          [control]="bg.overlayColor"
          i18n-label="@@editor.settings.overlayColor"
          label="Overlay colour"
          (previewed)="previewImage({ overlayColor: $event })"
          (committed)="commitBackground()"
        />
        <div class="overlay-opacity">
          <span class="slider-label" i18n="@@editor.settings.overlayOpacity">
            Overlay opacity: {{ overlayOpacity() }} %
          </span>
          <mat-slider
            [min]="limits.overlayOpacityPercent.min"
            [max]="limits.overlayOpacityPercent.max"
            [step]="limits.overlayOpacityPercent.step"
            i18n-aria-label="@@editor.settings.overlayOpacityAria"
            aria-label="Overlay opacity"
          >
            <input
              matSliderThumb
              [value]="overlayOpacity()"
              (input)="previewOverlayOpacity($event)"
              (change)="commitBackground()"
            />
          </mat-slider>
        </div>
        <div class="background-blur">
          <span class="slider-label" i18n="@@editor.settings.backgroundBlur">
            Blur: {{ blurMm() }} mm
          </span>
          <mat-slider
            [min]="limits.backgroundBlurMm.min"
            [max]="limits.backgroundBlurMm.max"
            [step]="limits.backgroundBlurMm.step"
            i18n-aria-label="@@editor.settings.backgroundBlurAria"
            aria-label="Background blur"
          >
            <input
              matSliderThumb
              [value]="blurMm()"
              (input)="previewBlur($event)"
              (change)="commitBackground()"
            />
          </mat-slider>
        </div>
      }
    }
    <app-border-fields
      [widthControl]="form.controls.borderWidthMm"
      [colorControl]="form.controls.borderColor"
      (colorPreview)="previewBorderColor($event)"
      (committed)="commitBorder()"
    />
    <p class="settings-note" i18n="@@editor.settings.borderHint">
      Default border of all photos without an own border.
    </p>
    <button
      matButton="outlined"
      type="button"
      class="apply-to-all-button"
      [disabled]="!hasBorderOverrides()"
      (click)="applyBorderToAll.emit()"
    >
      <mat-icon>border_outer</mat-icon>
      <span i18n="@@editor.settings.applyBorderToAll">Apply to all photos</span>
    </button>
    <p class="settings-note" i18n="@@editor.settings.applyBorderToAllHint">
      Removes the individual borders of all photos.
    </p>
    <app-shadow-fields
      [group]="form.controls.shadow"
      (colorPreview)="previewShadowColor($event)"
      (committed)="commitShadow()"
    />
    <p class="settings-note" i18n="@@editor.settings.shadowHint">
      Default shadow of all photos without an own shadow.
    </p>
    <button
      matButton="outlined"
      type="button"
      class="apply-to-all-button"
      [disabled]="!hasShadowOverrides()"
      (click)="applyShadowToAll.emit()"
    >
      <mat-icon>shadow</mat-icon>
      <span i18n="@@editor.settings.applyShadowToAll">Apply to all photos</span>
    </button>
    <p class="settings-note" i18n="@@editor.settings.applyShadowToAllHint">
      Removes the individual shadows of all photos.
    </p>
  `,
  styleUrl: '../fields/panel-section.scss',
  styles: `
    .apply-to-all-button {
      align-self: flex-start;
    }

    .background-image-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .background-thumbnail {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: var(--mat-sys-corner-small);
    }

    .overlay-opacity,
    .background-blur {
      display: flex;
      flex-direction: column;
    }

    .slider-label {
      font: var(--mat-sys-body-medium);
    }

    mat-slider {
      width: 100%;
      margin: 0;
    }
  `,
})
export class AppearanceSettingsSection {
  readonly background = input.required<BackgroundSettings>();
  readonly defaultBorder = input.required<BorderSettings>();
  readonly defaultShadow = input.required<Shadow>();
  /** File URL of the bg photo (thumbnail); `null` without a bg photo (the hint is shown). */
  readonly backgroundImageUrl = input<string | null>(null);
  /** True if at least one photo has an own border ("Apply to all photos" is enabled only then). */
  readonly hasBorderOverrides = input(false);
  /** True if at least one photo has an own shadow (its "Apply to all photos" is enabled only then). */
  readonly hasShadowOverrides = input(false);
  /** The whole background with the changed values (values of other types stay). */
  readonly backgroundChange = output<BackgroundSettings>();
  readonly defaultBorderChange = output<BorderSettings>();
  readonly defaultShadowChange = output<Shadow>();
  /**
   * The whole background while a colour is changed in a picker or the overlay opacity or blur
   * slider moves (not committed).
   */
  readonly backgroundPreview = output<BackgroundSettings>();
  /** Default border while its colour is changed in the picker (not committed). */
  readonly defaultBorderPreview = output<BorderSettings>();
  /** Default shadow while its colour is changed in the picker (not committed). */
  readonly defaultShadowPreview = output<Shadow>();
  readonly applyBorderToAll = output<void>();
  readonly applyShadowToAll = output<void>();

  protected readonly limits = SETTINGS_LIMITS;

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly defaults = defaultCollageSettings();
  protected readonly form = this.fb.group({
    background: this.fb.group({
      type: [this.defaults.background.type],
      color: [this.defaults.background.color],
      gradient: this.fb.group({
        kind: [this.defaults.background.gradient.kind],
        from: [this.defaults.background.gradient.from],
        to: [this.defaults.background.gradient.to],
        angleDeg: [
          this.defaults.background.gradient.angleDeg,
          limitValidators(this.limits.gradientAngleDeg),
        ],
      }),
      overlayColor: [this.defaults.background.image.overlayColor],
    }),
    borderWidthMm: [this.defaults.defaultBorder.widthMm, limitValidators(BORDER_WIDTH_LIMITS)],
    borderColor: [this.defaults.defaultBorder.color],
    shadow: shadowFormGroup(this.fb, this.defaults.defaultShadow),
  });

  /** Background type shown in the select (equals `background().type` after each commit). */
  protected readonly selectedType = toSignal(
    this.form.controls.background.controls.type.valueChanges,
    {
      initialValue: this.form.controls.background.controls.type.value,
    },
  );
  /** Gradient kind shown in the select (the angle field is shown only for `linear`). */
  protected readonly selectedGradientKind = toSignal(
    this.form.controls.background.controls.gradient.controls.kind.valueChanges,
    { initialValue: this.form.controls.background.controls.gradient.controls.kind.value },
  );

  /** Overlay opacity (%) shown by the slider; follows the thumb while it moves. */
  protected readonly overlayOpacity = signal(this.defaults.background.image.overlayOpacityPercent);
  /** Blur radius (mm) of the bg photo shown by the slider; follows the thumb while it moves. */
  protected readonly blurMm = signal(this.defaults.background.image.blurMm);

  constructor() {
    syncFromInput(this.background, ({ type, color, gradient, image }) => {
      this.form.controls.background.reset({
        type,
        color,
        gradient,
        overlayColor: image.overlayColor,
      });
      this.overlayOpacity.set(image.overlayOpacityPercent);
      this.blurMm.set(image.blurMm);
    });
    syncFromInput(this.defaultBorder, ({ widthMm, color }) => {
      this.form.controls.borderWidthMm.reset(widthMm);
      this.form.controls.borderColor.setValue(color);
    });
    // Resets with events: the shadow fields follow the `enabled` control.
    syncFromInput(this.defaultShadow, (shadow) => {
      this.form.controls.shadow.reset(toShadowFormValue(shadow));
    });
  }

  /** Emits the background of the form; an invalid angle is marked and nothing is emitted. */
  protected commitBackground(change: Partial<BackgroundSettings> = {}): void {
    const { angleDeg } = this.form.controls.background.controls.gradient.controls;
    if (angleDeg.invalid) {
      angleDeg.markAsTouched();
      return;
    }
    this.backgroundChange.emit({ ...this.formBackground(), ...change });
  }

  /** "Remove image": commits the background without a bg photo (the type stays `image`). */
  protected removeImage(): void {
    const { image } = this.formBackground();
    this.commitBackground({ image: { ...image, photoId: null } });
  }

  /** Emits the background of the form with a changed image value as a preview (not committed). */
  protected previewImage(change: Partial<ImageBackgroundSettings>): void {
    const background = this.formBackground();
    this.previewBackground({ image: { ...background.image, ...change } });
  }

  /** The slider thumb moves: shows the value and previews it (committed on release). */
  protected previewOverlayOpacity(event: Event): void {
    const percent = (event.target as HTMLInputElement).valueAsNumber;
    this.overlayOpacity.set(percent);
    this.previewImage({ overlayOpacityPercent: percent });
  }

  /** The blur slider thumb moves: shows the value and previews it (committed on release). */
  protected previewBlur(event: Event): void {
    const blurMm = (event.target as HTMLInputElement).valueAsNumber;
    this.blurMm.set(blurMm);
    this.previewImage({ blurMm });
  }

  /** Emits the background of the form with a changed value as a preview (not committed). */
  protected previewBackground(change: Partial<BackgroundSettings>): void {
    this.backgroundPreview.emit({ ...this.formBackground(), ...change });
  }

  /** Emits the background of the form with a changed gradient value as a preview (not committed). */
  protected previewGradient(change: Partial<GradientSettings>): void {
    const background = this.formBackground();
    this.previewBackground({ gradient: { ...background.gradient, ...change } });
  }

  protected previewBorderColor(color: string): void {
    const { borderWidthMm } = this.form.controls;
    if (borderWidthMm.valid) {
      this.defaultBorderPreview.emit({ widthMm: borderWidthMm.value, color });
    }
  }

  protected commitBorder(): void {
    const { borderWidthMm, borderColor } = this.form.controls;
    if (borderWidthMm.invalid) {
      borderWidthMm.markAsTouched();
      return;
    }
    this.defaultBorderChange.emit({ widthMm: borderWidthMm.value, color: borderColor.value });
  }

  /** Emits the default shadow of the form with the picker colour as a preview (only if valid). */
  protected previewShadowColor(color: string): void {
    const { shadow } = this.form.controls;
    if (shadow.valid) {
      this.defaultShadowPreview.emit({ ...shadowFromFormValue(shadow.getRawValue()), color });
    }
  }

  /** Emits the default shadow of the form; invalid fields are marked and nothing is emitted. */
  protected commitShadow(): void {
    const { shadow } = this.form.controls;
    if (shadow.invalid) {
      shadow.markAllAsTouched();
      return;
    }
    this.defaultShadowChange.emit(shadowFromFormValue(shadow.getRawValue()));
  }

  /**
   * The input background with the values of the form and the slider (the bg photo is not edited
   * here and stays). An invalid angle keeps the angle of the input.
   */
  private formBackground(): BackgroundSettings {
    const current = this.background();
    const { type, color, gradient, overlayColor } = this.form.controls.background.getRawValue();
    const angleValid = this.form.controls.background.controls.gradient.controls.angleDeg.valid;
    return {
      ...current,
      type,
      color,
      gradient: {
        ...gradient,
        angleDeg: angleValid ? gradient.angleDeg : current.gradient.angleDeg,
      },
      image: {
        ...current.image,
        overlayColor,
        overlayOpacityPercent: this.overlayOpacity(),
        blurMm: this.blurMm(),
      },
    };
  }
}
