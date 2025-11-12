// // app/api/stream/route.js
// export const runtime = "nodejs"; // or "edge" if you prefer (Edge may need minor changes)

// export async function GET(req) {
//   const { searchParams } = new URL(req.url);
//   const prompt = searchParams.get("prompt") || "Say hi!";
//   const apiKey = process.env.OPENAI_API_KEY;
//   if (!apiKey) return new Response("No OPENAI_API_KEY", { status: 500 });

//   const openaiRes = await fetch("https://api.openai.com/v1/responses", {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${apiKey}`,
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       model: "gpt-4o-mini-2024-07-18", // or a model you have access to
//       input: prompt,
//       stream: true,
//     }),
//   });

//   if (!openaiRes.ok) {
//     const txt = await openaiRes.text();
//     return new Response(txt, { status: openaiRes.status });
//   }

//   // Create SSE-ready ReadableStream that forwards ONLY text deltas (or simple JSON)
//   const stream = new ReadableStream({
//     async start(controller) {
//       const reader = openaiRes.body.getReader();
//       const decoder = new TextDecoder();
//       let buffer = "";

//       try {
//         while (true) {
//           const { done, value } = await reader.read();
//           if (done) break;
//           buffer += decoder.decode(value, { stream: true });

//           // OpenAI stream sends blocks separated by double newlines
//           let doubleNL;
//           while ((doubleNL = buffer.indexOf("\n\n")) !== -1) {
//             const chunk = buffer.slice(0, doubleNL);
//             buffer = buffer.slice(doubleNL + 2);

//             // chunk may contain multiple lines; find data: lines
//             const lines = chunk.split(/\r?\n/);
//             for (const line of lines) {
//               const trimmed = line.trim();
//               if (!trimmed) continue;

//               // typical line: data: {"type":"response.output_text.delta", ...}
//               const m = trimmed.match(/^data:\s*(.*)$/);
//               if (!m) continue;
//               const payloadRaw = m[1];

//               if (payloadRaw === "[DONE]") {
//                 // signal done to client
//                 controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
//                 continue;
//               }

//               // try parse json
//               let payload;
//               try {
//                 payload = JSON.parse(payloadRaw);
//               } catch {
//                 // not JSON — forward raw text
//                 controller.enqueue(new TextEncoder().encode(`data: ${payloadRaw}\n\n`));
//                 continue;
//               }

//               // handle different event types
//               const type = payload.type;
//               // For response.output_text.delta events, delta contains token text
//               if (type === "response.output_text.delta") {
//                 const delta = payload.delta ?? "";
//                 if (delta) controller.enqueue(new TextEncoder().encode(`data: ${delta}\n\n`));
//                 continue;
//               }

//               // For other events, try to pull final plain text if present
//               // e.g. response.content_part.done or response.output_item.done
//               // payload.response?.output may contain final text
//               if (payload.response?.output) {
//                 try {
//                   const pieces = payload.response.output
//                     .flatMap((it) => it.content ?? [])
//                     .map((c) => c.text ?? "")
//                     .filter(Boolean);
//                   if (pieces.length) {
//                     const txt = pieces.join("");
//                     controller.enqueue(new TextEncoder().encode(`data: ${txt}\n\n`));
//                   }
//                 } catch {}
//               }

//               // fallback: if payload has content text fields
//               const fallbackText =
//                 payload.text?.toString?.() ||
//                 payload.output?.[0]?.content?.[0]?.text ||
//                 null;
//               if (fallbackText) {
//                 controller.enqueue(new TextEncoder().encode(`data: ${fallbackText}\n\n`));
//               }
//             } // lines loop
//           } // while doubleNL
//         } // while reader.read

//         // leftover buffer
//         if (buffer.trim()) {
//           // attempt to parse leftover data lines
//           const lines = buffer.split(/\r?\n/);
//           for (const line of lines) {
//             const m = line.match(/^data:\s*(.*)$/);
//             if (m) {
//               const payloadRaw = m[1];
//               if (payloadRaw === "[DONE]") {
//                 controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
//               } else {
//                 try {
//                   const payload = JSON.parse(payloadRaw);
//                   const delta = payload.delta ?? payload.text ?? "";
//                   if (delta) controller.enqueue(new TextEncoder().encode(`data: ${delta}\n\n`));
//                 } catch {
//                   controller.enqueue(new TextEncoder().encode(`data: ${payloadRaw}\n\n`));
//                 }
//               }
//             }
//           }
//         }

//         // final signal
//         controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
//         controller.close();
//       } catch (err) {
//         controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
//         controller.close();
//       } finally {
//         reader.releaseLock?.();
//       }
//     },
//   });

//   return new Response(stream, {
//     status: 200,
//     headers: {
//       "Content-Type": "text/event-stream",
//       "Cache-Control": "no-cache, no-transform",
//       Connection: "keep-alive",
//     },
//   });
// }

// app/api/stream/route.js
export const runtime = "edge"; // use "edge" for lower RTT on Vercel; fallback to "nodejs" if needed

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get("prompt") || "Say hi!";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });

  // Start the streaming fetch to OpenAI
  const openaiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Choose a low-latency model & limit output tokens for speed
    body: JSON.stringify({
      model: "gpt-4o-mini-2024-07-18", // test smaller models for better latency
      input: prompt,
      stream: true,
      // optional: limit max tokens for faster completion
      max_output_tokens: 30
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    return new Response(errText, { status: openaiRes.status });
  }

  // Build a ReadableStream that emits valid SSE frames: data: <text>\n\n
  const stream = new ReadableStream({
    async start(controller) {
      // Immediately send a tiny heartbeat so client can exit "thinking" state
      controller.enqueue(new TextEncoder().encode(`data: \n\n`)); // blank chunk triggers client to show typing state

      const reader = openaiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // OpenAI sends blocks separated by double-newline; split and handle each
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            // each block contains lines; look for "data: ..." lines
            const lines = block.split(/\r?\n/);
            for (const line of lines) {
              if (!line.trim()) continue;
              const m = line.match(/^data:\s*(.*)$/);
              if (!m) continue;
              const payloadRaw = m[1];

              if (payloadRaw === "[DONE]") {
                // forward final marker and close
                controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
                continue;
              }

              // parse JSON payload
              let payload;
              try {
                payload = JSON.parse(payloadRaw);
              } catch {
                // not JSON — forward raw
                controller.enqueue(new TextEncoder().encode(`data: ${payloadRaw}\n\n`));
                continue;
              }

              // If the event is a text delta, forward only the delta text
              if (payload.type === "response.output_text.delta") {
                const delta = payload.delta ?? "";
                if (delta) {
                  controller.enqueue(new TextEncoder().encode(`data: ${delta}\n\n`));
                }
                continue;
              }

              // If the payload contains final text in response.output, forward it
              if (payload.response?.output) {
                try {
                  const parts = payload.response.output
                    .flatMap((o) => o.content ?? [])
                    .map((c) => c.text ?? "")
                    .filter(Boolean);
                  if (parts.length) {
                    controller.enqueue(new TextEncoder().encode(`data: ${parts.join("")}\n\n`));
                  }
                } catch {}
              }
            } // lines loop
          } // while doubleNL
        } // reader loop

        // leftover buffer handling
        if (buffer.trim()) {
          controller.enqueue(new TextEncoder().encode(`data: ${buffer}\n\n`));
        }

        // signal done and close
        controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        controller.close();
      } finally {
        reader.releaseLock?.();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Add CORS header if your front-end origin differs:
      // "Access-Control-Allow-Origin": "*",
    },
  });
}

