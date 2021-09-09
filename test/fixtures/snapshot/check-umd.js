'use strict';

const md = `
# heading

[link][1]

[1]: #heading "heading"
`;

const html = marked(md)
console.log(html);
