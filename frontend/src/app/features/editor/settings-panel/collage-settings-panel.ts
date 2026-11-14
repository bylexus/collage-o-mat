import { Component, input, output } from '@angular/core';
import { ArrangementMode, CollageSettings, DisplayUnit } from '../../../core/models/collage';
import { LengthUnit } from '../geometry/length-unit';
import { AppearanceSettingsSection } from './appearance-settings-section';
import { ArrangementSettingsSection } from './arrangement-settings-section';
import { PageSettingsSection } from './page-settings-section';

/**
 * Side panel with the collage settings (presentational). Emits a new settings object on each
 * committed, valid change (`settingsChange`) and while a colour is changed in a picker
 * (`settingsPreview`, not committed); changes do not re-arrange the photos. The arrangement
 * parameters are edited in a dialog ("Re-arrange…", `openArrangement`). Actions on the photos
 * ("Apply to all photos") are separate outputs.
 */
@Component({
  selector: 'app-collage-settings-panel',
  imports: [AppearanceSettingsSection, ArrangementSettingsSection, PageSettingsSection],
  templateUrl: './collage-settings-panel.html',
  styleUrl: './collage-settings-panel.scss',
})
export class CollageSettingsPanel {
  readonly settings = input.required<CollageSettings>();
  /** Display unit of the lengths with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  readonly photoCount = input<number>(0);
  /** File URL of the bg photo (Appearance thumbnail); `null` without a bg photo. */
  readonly backgroundImageUrl = input<string | null>(null);
  /** True if at least one photo has an own border (enables "Apply to all photos"). */
  readonly hasBorderOverrides = input(false);
  /** True if at least one photo has an own shadow (enables the shadow "Apply to all photos"). */
  readonly hasShadowOverrides = input(false);

  readonly settingsChange = output<CollageSettings>();
  /** Settings while a colour is changed in a picker (not committed). */
  readonly settingsPreview = output<CollageSettings>();
  /** "Re-arrange…": open the arrangement settings dialog for this mode. */
  readonly openArrangement = output<ArrangementMode>();
  /** Quick re-roll: re-arrange again with the saved settings. */
  readonly rearrangeAgain = output<void>();
  /** "Apply to all photos" of the default border: remove the own borders of all photos. */
  readonly applyBorderToAll = output<void>();
  /** "Apply to all photos" of the default shadow: remove the own shadows of all photos. */
  readonly applyShadowToAll = output<void>();
  /** The user selected another display unit (not an undo step, so not in `settingsChange`). */
  readonly displayUnitChange = output<DisplayUnit>();

  /** Emits the current settings with the changed parts replaced (a new object). */
  protected update(change: Partial<CollageSettings>): void {
    this.settingsChange.emit({ ...this.settings(), ...change });
  }

  /** Emits the current settings with the changed parts replaced, as a preview (not committed). */
  protected preview(change: Partial<CollageSettings>): void {
    this.settingsPreview.emit({ ...this.settings(), ...change });
  }
}
