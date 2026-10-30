"use client";
import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
type Span = {
  id: string;
  start_utf16: number;
  end_utf16: number;
  exact_quote: string;
};
type Selection = {
  start_utf16: number;
  end_utf16: number;
  exact_quote: string;
};
const annotationKey = new PluginKey<Span[]>("skillforgeAnnotations");
function positionFor(doc: ProseMirrorNode, offset: number) {
  let result: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText || result !== null) return;
    const start = doc.textBetween(0, pos, "\n").length;
    if (offset >= start && offset <= start + node.nodeSize)
      result = pos + offset - start;
  });
  return result;
}
const annotationExtension = Extension.create({
  name: "skillforgeAnnotations",
  addProseMirrorPlugins() {
    return [
      new Plugin<Span[]>({
        key: annotationKey,
        // Keep keyboard selection while rejecting any mutation of this version.
        filterTransaction: (transaction) => !transaction.docChanged,
        state: {
          init: () => [],
          apply: (tr, previous) => tr.getMeta(annotationKey) ?? previous,
        },
        props: {
          decorations(state) {
            const text = state.doc.textBetween(0, state.doc.content.size, "\n");
            return DecorationSet.create(
              state.doc,
              (annotationKey.getState(state) ?? []).flatMap((s) => {
                if (text.slice(s.start_utf16, s.end_utf16) !== s.exact_quote)
                  return [];
                const from = positionFor(state.doc, s.start_utf16),
                  to = positionFor(state.doc, s.end_utf16);
                return from !== null && to !== null
                  ? [
                      Decoration.inline(from, to, {
                        class: "annotation-mark",
                        "data-annotation": s.id,
                      }),
                    ]
                  : [];
              }),
            );
          },
        },
      }),
    ];
  },
});
export default function AnnotationEditor({
  content,
  spans,
  onSelection,
}: {
  content: Record<string, unknown>;
  spans: Span[];
  onSelection: (value: Selection) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, annotationExtension],
    content,
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "圈选文档",
        "aria-readonly": "true",
        tabindex: "0",
      },
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      if (from === to) return;
      onSelection({
        start_utf16: editor.state.doc.textBetween(0, from, "\n").length,
        end_utf16: editor.state.doc.textBetween(0, to, "\n").length,
        exact_quote: editor.state.doc.textBetween(from, to, "\n"),
      });
    },
  });
  useEffect(() => {
    if (editor)
      editor.view.dispatch(editor.state.tr.setMeta(annotationKey, spans));
  }, [editor, spans]);
  return <EditorContent editor={editor} />;
}
