// The colours of the emails: the Fresh Start blues, the same as
// public/css/theme.css. Emails can't read the site's stylesheet, so the values
// are written out here, and email-colours.spec.ts checks they are readable.
// Change them together with theme.css when you re-colour a site.
export const EMAIL_COLOURS = {
  ink: '#12233A', // body text
  muted: '#4D6178', // labels and the footer
  primary: '#1A5BB5', // headings, links and the stripe at the top
  action: '#123A66', // the button
  onAction: '#FFFFFF', // text on the button
  callout: '#E3F0FC', // the notice box
  line: '#D6E3F3', // dividers
} as const;
