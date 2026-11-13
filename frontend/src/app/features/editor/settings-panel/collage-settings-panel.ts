import { Component, input, output } from '@angular/core';
import { CollageSettings } from '../../../core/models/collage';
import { AppearanceSettingsSection } from './appearance-settings-section';
import { ArrangementSettingsSection } from './arrangement-settings-section';
import { PageSettingsSection } from './page-settings-section';

/**
 * Side panel with the collage settings (presentational). Emits a new settings object on each
 * committed, valid change; changes do not re-arrange the photos (the user clicks "Re-arrange").
 * Actions on the photos ("Re-arrange", "Apply to all photos") are separate outputs.
 */
@Component({
  selector: 'app-collage-settings-panel',
  imports: [AppearanceSettingsSection, ArrangementSettingsSection, PageSettingsSection],
  templateUrl: './collage-settings-panel.html',
  styleUrl: './collage-settings-panel.scss',
})
export class CollageSettingsPanel {
  readonly settings = input.required<CollageSettings>();
  readonly photoCount = input<number>(0);
  /** True if at least one photo has an own border (enables "Apply to all photos"). */
  readonly hasBorderOverrides = input(false);

  readonly settingsChange = output<CollageSettings>();
  readonly rearrange = output<void>();
  /** "Apply to all photos" of the default border: remove the own borders of all photos. */
  readonly applyBorderToAll = output<void>();

  /** Emits the current settings with the changed parts replaced (a new object). */
  protected update(change: Partial<CollageSettings>): void {
    this.settingsChange.emit({ ...this.settings(), ...change });
  }
}
