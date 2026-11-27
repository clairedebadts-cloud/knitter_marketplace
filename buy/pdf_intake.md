# Step 0: PDF pattern intake (no conversion needed)

Claude reads PDFs directly, including size tables, charts and scanned pages.
Send the PDF as a document block in the same call as the Step 1 extraction prompt.

## n8n nodes

1. **Form Trigger**
   - Field `pattern` (File, accept `.pdf`)
   - Field `size` (Text, e.g. "M")

2. **Extract From File**
   - Operation: *Move File to Base64 String*
   - Input binary field: `pattern`
   - Destination output field: `pdf_b64`

3. **HTTP Request** (POST `https://api.anthropic.com/v1/messages`)
   - Headers:
     - `x-api-key`: your key (store it as an n8n credential, never in the workflow JSON you commit)
     - `anthropic-version`: `2023-06-01`
     - `content-type`: `application/json`
   - Body (JSON, expression mode):

```json
{
  "model": "claude-haiku-5-5",
  "max_tokens": 2000,
  "system": "PASTE THE SYSTEM PROMPT FROM 1_extract_pattern_prompt.md",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": "{{ $json.pdf_b64 }}"
          }
        },
        {
          "type": "text",
          "text": "Size: {{ $('Form Trigger').item.json.size }}\nExtract the materials list as JSON."
        }
      ]
    }
  ]
}
```

4. **Code node**: parse the reply
```js
const text = $json.content[0].text;
const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
return [{ json: { pattern: json } }];
```

## Limits and cost
- Max 32 MB and 100 pages per PDF. Patterns are usually 2 to 15 pages.
- Each page costs roughly 1,500 to 3,000 tokens (text plus page image).
  A 10-page pattern on Haiku is a few cents, so $30 covers hundreds of test runs.
- If a pattern is long, the materials are almost always on page 1 or 2: still send the
  whole PDF, since skein counts per size are sometimes in a table further in.

## Fallback if the HTTP call fails
Extract From File, operation *Extract From PDF*, gives plain text. It works for text PDFs
but loses table layout (size columns get scrambled) and returns nothing for scanned PDFs.
Use it only as a backup.
