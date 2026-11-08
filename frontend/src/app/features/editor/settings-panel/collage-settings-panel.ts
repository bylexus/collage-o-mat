import { Component, input, output } from '@angular/core';
import { CollageSettings } from '../../../core/models/collage';
import { AppearanceSettingsSection } from './appearance-settings-section';
import { ArrangementSettingsSection } from './arrangement-settings-section';
import { PageSettingsSection } from './page-settings-section';

/**
 * Side panel with the collage settings (presentational). Emits a new settings object on each
 * committed, valid change; changes do not re-arrange the photos (the user clicks "Re-arrange").
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

  readonly settingsChange = output<CollageSettings>();
  readonly rearrange = output<void>();

  /** Emits the current settings with the changed parts replaced (a new object). */
  protected update(change: Partial<CollageSettings>): void {
    this.settingsChange.emit({ ...this.settings(), ...change });
  }
}
