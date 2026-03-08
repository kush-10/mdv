# Markdown Feature Matrix

This file exercises the syntax supported by `mdv`.

## Basic Syntax

### ATX headings

#### Heading level 4

##### Heading level 5

###### Heading level 6

Setext heading level 1
======================

Setext heading level 2
----------------------

This is a paragraph with regular text.

This line ends with an HTML line break.<br>
This is on the next line.

Emphasis examples: *italic*, **bold**, ***bold and italic***, and `inline code`.

Backtick escaping example: ``Use `code` literally.``

> This is a blockquote.
>
> It can contain multiple paragraphs.
>
> > This is a nested blockquote.

Ordered list:

1. First item
2. Second item
   1. Nested item
   2. Nested item
3. Third item

Unordered list:

- Alpha
- Beta
  - Beta child
- Gamma

Indented code block:

    const fromIndented = true;
    console.log(fromIndented);

Fenced code block with language:

```ts
type User = { id: string; name: string };

const user: User = { id: 'u1', name: 'Ava' };
console.log(user.name);
```

Horizontal rule:

---

Links:

- [Markdown Guide](https://www.markdownguide.org/ "Reference docs")
- <https://www.example.com>
- <fake@example.com>

Image:

![Files icon](/favicon-32.png "Favicon sample")

Escaping characters:

\* Not a list item
\# Not a heading

Inline HTML (sanitized):

<div><strong>Inline HTML works.</strong> Unsafe attributes are stripped.</div>
<script>alert('this should be removed')</script>

## Extended Syntax

### Tables

| Syntax | Description | Alignment |
| :----- | :---------: | --------: |
| Header | Centered    | Right     |
| Pipe   | `a &#124; b` | Value    |

### Footnotes

Here is a short footnote reference.[^1]
Here is a named footnote.[^note]

[^1]: This is the first footnote.
[^note]: This footnote can contain multiple lines.
    This second line is still part of the same footnote.

### Heading IDs and anchor links

### Custom Anchor Heading {#custom-anchor}

You can jump to this heading with [this link](#custom-anchor).

### Definition lists

Markdown
: A lightweight markup language.

mdv
: A local-first markdown viewer.

### Strikethrough

~~This text is obsolete.~~ This text is current.

### Task list

- [x] Parse markdown
- [x] Render syntax features
- [ ] Add more fixtures

### Emoji shortcodes

- Gone camping: :tent:
- Laughing: :joy:
- Rocket launch: :rocket:

### Highlight, subscript, superscript

Use ==highlight== for important text.

Water is H~2~O.

Math example: X^2^ + Y^2^ = Z^2^.

### Automatic URL linking

Bare URL should autolink: https://example.org/docs/markdown

Disable autolink by using code: `https://example.org/docs/markdown`

[this link](#custom-anchor).
