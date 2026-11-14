import { Component } from '@angular/core';
import { CopyrightNotice } from '../../shared/copyright-notice';

/** About page: short app description and copyright notice. */
@Component({
  selector: 'app-about-page',
  imports: [CopyrightNotice],
  templateUrl: './about.page.html',
  styleUrl: './about.page.scss',
})
export class AboutPage {}
