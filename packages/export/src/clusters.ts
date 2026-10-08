/**
 * Citations side by side, in every export — R40, ADR-0117.
 *
 * `renderCitations` hands a run of adjacent citations to citeproc as one citation and returns it
 * as a cluster: the node keys and one label, "(Kumar, 2021; Rao, 2020)". Each exporter walks the
 * chapter one inline node at a time, so this is the one rule they share for what a citation node
 * prints: a cluster's label once, at its first node, and nothing at the others. The `.docx`
 * links or fields it from all of its nodes, LaTeX writes one `\parencite{a,b}`.
 *
 * The cluster is trusted only where the nodes really are side by side in the same order. They
 * always are when the clusters were rendered from the same content, which every caller does; if
 * they are not, each node prints its own label, which is what every export printed before.
 */

import { type CitationCluster, type ClusterPlace, clusterPlaces } from '@tc/citations';

export type ExportCitationNode = { type?: string; attrs?: Record<string, unknown> };

export type CitationPrint =
  /** A later node of a cluster that was printed at its first node. */
  | { kind: 'skip' }
  | {
      kind: 'print';
      /** The label, or undefined when there is none (the exporter's "(source missing)"). */
      label: string | undefined;
      /** The node itself, or every node of its cluster, in document order. */
      nodes: ExportCitationNode[];
      cluster: boolean;
    };

const keyOf = (node: ExportCitationNode | undefined): string =>
  node?.type === 'citation' && typeof node.attrs?.key === 'string' ? node.attrs.key : '';

const places = new WeakMap<readonly CitationCluster[], ReadonlyMap<string, ClusterPlace>>();

function placesOf(clusters: readonly CitationCluster[]): ReadonlyMap<string, ClusterPlace> {
  let found = places.get(clusters);
  if (!found) {
    found = clusterPlaces(clusters);
    places.set(clusters, found);
  }
  return found;
}

function sideBySide(siblings: readonly ExportCitationNode[], start: number, keys: string[]) {
  return start >= 0 && keys.every((key, j) => keyOf(siblings[start + j]) === key);
}

/** What the citation at `siblings[index]` prints. */
export function printCitation(
  siblings: readonly ExportCitationNode[],
  index: number,
  renderedMap: Readonly<Record<string, string>>,
  clusters: readonly CitationCluster[] | undefined,
): CitationPrint {
  const node = siblings[index] as ExportCitationNode;
  const key = keyOf(node);
  const alone: CitationPrint = {
    kind: 'print',
    label: renderedMap[key],
    nodes: [node],
    cluster: false,
  };
  if (!clusters || clusters.length === 0 || !key) return alone;
  const place = placesOf(clusters).get(key);
  if (!place) return alone;
  const { keys, label } = place.cluster;
  const start = index - keys.indexOf(key);
  if (!sideBySide(siblings, start, keys)) return alone;
  if (!place.first) return { kind: 'skip' };
  return { kind: 'print', label, nodes: siblings.slice(index, index + keys.length), cluster: true };
}
