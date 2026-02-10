import { Quad } from "@rdfjs/types";
import { marked } from "marked";
import { escapeHTML } from "./shared.js";
import { formatQuadsToMarkdown, formatQuadsToTtl } from "./quads.js";
import { formatQuadsToUserHtml } from "./user.js";
import type { Explanation, ExplanationStep } from "../../types/index.js";

/**
 * Converts quads to Cytoscape-compatible graph data with proper type classification
 */
function quadsToGraphData(quads: Quad[]): { nodes: any[], edges: any[] } {
    const nodesMap = new Map<string, any>();
    const edges: any[] = [];
    const classNodes = new Set<string>(); // Track nodes that are used as classes (objects of rdf:type)

    // First pass: identify class nodes
    quads.forEach(quad => {
        const predicateUri = quad.predicate.value;
        if (predicateUri === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            classNodes.add(quad.object.value);
        }
    });

    quads.forEach((quad, idx) => {
        const subjectId = quad.subject.value;
        const objectId = quad.object.value;
        const predicateUri = quad.predicate.value;
        const predicateLabel = predicateUri.split(/[#/]/).pop() || predicateUri;

        // Determine edge type
        const isTypeEdge = predicateUri === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
        const isLiteralTarget = quad.object.termType === 'Literal';
        const edgeType = isTypeEdge ? 'type' : (isLiteralTarget ? 'dataProperty' : 'objectProperty');

        // Add subject node
        if (!nodesMap.has(subjectId)) {
            const label = subjectId.split(/[#/]/).pop() || subjectId;
            nodesMap.set(subjectId, {
                data: {
                    id: subjectId,
                    label: label,
                    fullLabel: label,
                    uri: subjectId,
                    nodeType: 'instance' // Regular instance node
                }
            });
        }

        // Add object node (could be class, instance, or literal)
        if (!nodesMap.has(objectId)) {
            const isLiteral = quad.object.termType === 'Literal';
            const isClass = classNodes.has(objectId);
            const label = isLiteral ? quad.object.value : (objectId.split(/[#/]/).pop() || objectId);

            let nodeType: string;
            if (isLiteral) {
                nodeType = 'literal';
            } else if (isClass) {
                nodeType = 'class';
            } else {
                nodeType = 'instance';
            }

            nodesMap.set(objectId, {
                data: {
                    id: objectId,
                    label: label,
                    fullLabel: label,
                    uri: isLiteral ? null : objectId,
                    nodeType: nodeType
                }
            });
        }

        // Add edge with type classification
        edges.push({
            data: {
                id: `edge-${idx}`,
                source: subjectId,
                target: objectId,
                label: predicateLabel,
                fullLabel: predicateUri,
                edgeType: edgeType
            }
        });
    });

    return {
        nodes: Array.from(nodesMap.values()),
        edges
    };
}

/**
 * Generates the full Citation HTML Page with Graph Visualization
 */
export async function generateCitationHtml(quads: Quad[], citationId: string, options?: { title?: string, description?: string }): Promise<string> {
    const title = options?.title || "Knowledge Graph Citation";

    // Generate TTL for the raw view
    const ttl = await formatQuadsToTtl(quads);

    // Generate graph data for Cytoscape
    const graphData = quadsToGraphData(quads);
    const graphDataJson = JSON.stringify(graphData);

    // Generate Table View (User-friendly HTML Grid)
    const tableHtml = formatQuadsToUserHtml(quads);

    let descriptionHtml = '';
    if (options?.description) {
        const descriptionRendered = await marked.parse(options.description);
        descriptionHtml = `
    <section class="description card">
        <div class="section-label">Overview</div>
        <div class="description-content">
            ${descriptionRendered}
        </div>
    </section>`;
    }

    return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} - ${citationId}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,800&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
    <script>
        (function() {
            try {
                const stored = localStorage.getItem('kg-theme');
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
            } catch (e) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
    <script src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
    <style>
        :root {
            --page: #f8fafc;
            --page-accent: #eef2f6;
            --card: #ffffff;
            --card-strong: #f8fafc;
            --ink: #0f172a;
            --muted: #64748b;
            --border: rgba(15, 23, 42, 0.12);
            --primary: #cc0634;
            --primary-50: #fbebef;
            --primary-100: #f7d7df;
            --primary-200: #f1b9c6;
            --primary-300: #eb9bae;
            --primary-400: #e3768f;
            --primary-500: #db5171;
            --primary-600: #ad052c;
            --primary-700: #8f0424;
            --primary-800: #70031d;
            --primary-900: #520215;
            --accent: var(--primary);
            --accent-2: var(--primary-400);
            --accent-3: var(--primary-600);
            --glow: rgba(204, 6, 52, 0.2);
            --shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
            --shadow-soft: 0 14px 40px rgba(15, 23, 42, 0.1);
            --grid: rgba(15, 23, 42, 0.05);
            --radius-lg: 24px;
            --radius-md: 16px;
            --radius-sm: 10px;
            --instance-color: var(--primary);
            --class-color: var(--primary-700);
            --literal-color: var(--primary-400);
            --type-edge-color: var(--primary-700);
            --data-edge-color: var(--primary-400);
            --object-edge-color: #64748b;
            --graph-bg: linear-gradient(150deg, #ffffff 0%, #f3f4f6 55%, #fdecef 100%);
        }

        html[data-theme="dark"] {
            --page: #0b1120;
            --page-accent: #111827;
            --card: #0f172a;
            --card-strong: #111827;
            --ink: #e2e8f0;
            --muted: #94a3b8;
            --border: rgba(148, 163, 184, 0.18);
            --accent: var(--primary);
            --accent-2: var(--primary-300);
            --accent-3: var(--primary-200);
            --glow: rgba(204, 6, 52, 0.35);
            --shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
            --shadow-soft: 0 18px 50px rgba(0, 0, 0, 0.35);
            --grid: rgba(148, 163, 184, 0.12);
            --instance-color: var(--primary-300);
            --class-color: var(--primary-100);
            --literal-color: var(--primary-400);
            --type-edge-color: var(--primary-200);
            --data-edge-color: var(--primary-300);
            --object-edge-color: #94a3b8;
            --graph-bg: radial-gradient(circle at top, rgba(204, 6, 52, 0.25), transparent 55%), radial-gradient(circle at 20% 80%, rgba(219, 81, 113, 0.2), transparent 55%), #0b1120;
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            font-family: "Manrope", "Segoe UI", Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: var(--ink);
            background: var(--page);
            min-height: 100vh;
            position: relative;
        }

        body::before {
            content: "";
            position: fixed;
            inset: -20vmax;
            background: radial-gradient(circle at 10% 10%, rgba(204, 6, 52, 0.08), transparent 45%),
                radial-gradient(circle at 85% 20%, rgba(204, 6, 52, 0.12), transparent 50%),
                radial-gradient(circle at 70% 80%, rgba(219, 81, 113, 0.1), transparent 40%);
            opacity: 0.7;
            z-index: -2;
        }

        body::after {
            content: "";
            position: fixed;
            inset: 0;
            background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                linear-gradient(90deg, var(--grid) 1px, transparent 1px);
            background-size: 48px 48px;
            opacity: 0.18;
            z-index: -1;
            pointer-events: none;
        }

        .page {
            max-width: 1280px;
            margin: 0 auto;
            padding: 36px 24px 54px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .hero {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 24px;
        }

        .hero-main {
            max-width: 720px;
        }

        .eyebrow {
            text-transform: uppercase;
            letter-spacing: 0.32em;
            font-size: 11px;
            color: var(--muted);
            font-weight: 600;
        }

        h1 {
            margin: 12px 0 10px;
            font-family: "Fraunces", "Times New Roman", serif;
            font-size: clamp(2.4rem, 3.5vw, 3.7rem);
            line-height: 1.1;
            color: var(--ink);
        }

        .hero-subtitle {
            font-size: 1.05rem;
            color: var(--muted);
            margin: 0;
        }

        .hero-aside {
            display: flex;
            flex-direction: column;
            gap: 12px;
            align-items: flex-end;
        }

        .meta-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .chip {
            background: var(--card-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 600;
            color: var(--muted);
            box-shadow: var(--shadow-soft);
        }

        .chip code {
            font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 11px;
            color: var(--ink);
            background: transparent;
        }

        .theme-toggle {
            border: 1px solid var(--border);
            background: var(--card);
            color: var(--ink);
            padding: 8px 14px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: var(--shadow-soft);
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .theme-toggle span {
            font-weight: 600;
        }

        .card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 20px 22px;
            box-shadow: var(--shadow-soft);
            backdrop-filter: blur(8px);
        }

        .section-label {
            font-size: 11px;
            letter-spacing: 0.24em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 12px;
            font-weight: 700;
        }

        .description-content {
            font-size: 15px;
            color: var(--ink);
        }

        .tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            padding: 6px;
            border-radius: 999px;
            background: var(--card);
            border: 1px solid var(--border);
            width: fit-content;
            box-shadow: var(--shadow-soft);
        }

        .tab-btn {
            padding: 10px 18px;
            border: none;
            border-radius: 999px;
            background: transparent;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            color: var(--muted);
            transition: all 0.2s ease;
        }

        .tab-btn:hover {
            color: var(--ink);
            background: var(--page-accent);
        }

        .tab-btn.active {
            color: var(--ink);
            background: linear-gradient(120deg, rgba(204, 6, 52, 0.18), rgba(219, 81, 113, 0.18));
            box-shadow: var(--shadow-soft);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
            animation: fadeUp 0.45s ease;
        }

        @keyframes fadeUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .graph-shell {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .graph-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            padding: 12px;
            background: var(--card-strong);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-soft);
        }

        #graph-container {
            width: 100%;
            height: 640px;
            border: 1px dashed var(--border);
            border-radius: var(--radius-lg);
            background: var(--graph-bg);
            position: relative;
            overflow: hidden;
        }

        .graph-btn,
        .graph-select {
            padding: 8px 12px;
            border: 1px solid var(--border);
            background: var(--page-accent);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: all 0.2s ease;
            font-family: "Manrope", "Segoe UI", Helvetica, Arial, sans-serif;
            color: var(--ink);
        }

        .graph-btn:hover,
        .graph-select:hover {
            border-color: var(--accent);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
            transform: translateY(-1px);
        }

        .graph-select {
            outline: none;
        }

        .graph-select:focus {
            border-color: var(--accent);
        }

        .node-info {
            position: absolute;
            bottom: 14px;
            left: 14px;
            background: var(--card-strong);
            padding: 12px 16px;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow);
            max-width: 420px;
            font-size: 13px;
            display: none;
            z-index: 10;
            border: 1px solid var(--border);
        }

        .node-info.visible {
            display: block;
        }

        .node-info strong {
            display: block;
            margin-bottom: 4px;
            color: var(--accent-3);
        }

        .node-info a {
            word-break: break-all;
        }

        .legend {
            position: absolute;
            top: 14px;
            left: 14px;
            background: rgba(255, 255, 255, 0.8);
            padding: 12px 16px;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-soft);
            font-size: 11px;
            z-index: 10;
            max-width: 200px;
            border: 1px solid var(--border);
            backdrop-filter: blur(8px);
        }

        html[data-theme="dark"] .legend {
            background: rgba(23, 30, 40, 0.75);
        }

        .legend-section {
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border);
        }

        .legend-section:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .legend-title {
            font-weight: 700;
            font-size: 10px;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 6px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 4px 0;
        }

        .legend-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .legend-dot.instance { background: var(--instance-color); }
        .legend-dot.class { background: var(--class-color); }
        .legend-dot.literal { background: var(--literal-color); border-radius: 3px; }

        .legend-line {
            width: 20px;
            height: 2px;
            flex-shrink: 0;
        }

        .legend-line.type-edge { background: var(--type-edge-color); }
        .legend-line.data-edge { background: var(--data-edge-color); }
        .legend-line.object-edge { background: var(--object-edge-color); }

        .cy-tooltip {
            position: absolute;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 12px;
            max-width: 320px;
            word-wrap: break-word;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .table-shell {
            overflow: hidden;
        }

        table {
            border-collapse: separate;
            border-spacing: 0;
            width: 100%;
            border-radius: var(--radius-md);
            overflow: hidden;
        }

        th, td {
            padding: 14px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border);
            font-size: 14px;
        }

        th {
            background: var(--card-strong);
            font-weight: 700;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        tr:nth-child(even) {
            background: rgba(255, 255, 255, 0.6);
        }

        html[data-theme="dark"] tr:nth-child(even) {
            background: rgba(255, 255, 255, 0.03);
        }

        tr:hover {
            background: rgba(204, 6, 52, 0.08);
        }

        a {
            text-decoration: none;
            color: var(--accent-3);
        }

        a:hover {
            text-decoration: underline;
        }

        .raw-section {
            background: var(--card-strong);
            padding: 20px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            overflow-x: auto;
        }

        pre {
            margin: 0;
            font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .term-wrapper {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .tech-term {
            display: inline-block;
            background: rgba(204, 6, 52, 0.12);
            color: var(--accent-3);
            font-size: 0.64em;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 999px;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            border: 1px solid rgba(204, 6, 52, 0.25);
            white-space: nowrap;
        }

        .property-grid {
            display: grid;
            grid-template-columns: minmax(160px, 26%) 1fr;
            gap: 1px;
            background-color: var(--border);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            overflow: hidden;
            margin-top: 12px;
            margin-bottom: 20px;
            box-shadow: var(--shadow-soft);
        }

        .prop-name,
        .prop-values {
            background-color: var(--card-strong);
            padding: 12px 16px;
        }

        .prop-name {
            font-weight: 700;
            color: var(--muted);
            border-right: 1px solid var(--border);
            font-size: 0.92em;
        }

        .prop-values {
            color: var(--ink);
            line-height: 1.6;
        }

        .value-tag {
            background: rgba(204, 6, 52, 0.12);
            color: var(--accent-3);
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid rgba(204, 6, 52, 0.2);
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-block;
        }

        .value-tag:hover {
            background: var(--accent-3);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 10px 18px rgba(204, 6, 52, 0.2);
        }

        .value-literal {
            background: rgba(219, 81, 113, 0.12);
            color: var(--accent-2);
            border-color: rgba(219, 81, 113, 0.25);
        }

        .value-literal:hover {
            background: var(--accent-2);
            color: #fff;
        }

        .value-more {
            background: transparent;
            color: var(--muted);
            border: 1px dashed var(--border);
            font-style: italic;
        }

        .value-more:hover {
            background: transparent;
            color: var(--muted);
            transform: none;
            box-shadow: none;
        }

        details {
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px 16px;
            background: var(--card-strong);
            margin-bottom: 16px;
            box-shadow: var(--shadow-soft);
        }

        details > summary {
            cursor: pointer;
            font-weight: 700;
            list-style: none;
            color: var(--ink);
        }

        details > summary::-webkit-details-marker {
            display: none;
        }

        details[open] > summary {
            margin-bottom: 10px;
        }

        .sub-prop {
            color: var(--ink);
        }

        .sub-prop-name {
            color: var(--muted) !important;
        }

        details {
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px 16px;
            background: var(--card-strong);
            margin-bottom: 16px;
            box-shadow: var(--shadow-soft);
        }

        details > summary {
            cursor: pointer;
            font-weight: 700;
            list-style: none;
            color: var(--ink);
        }

        details > summary::-webkit-details-marker {
            display: none;
        }

        details[open] > summary {
            margin-bottom: 10px;
        }

        .sub-prop {
            color: var(--ink);
        }

        .sub-prop-name {
            color: var(--muted) !important;
        }

        @media (max-width: 720px) {
            .page {
                padding: 28px 16px 40px;
            }

            .hero {
                align-items: flex-start;
            }

            .hero-aside {
                align-items: flex-start;
            }

            .property-grid {
                grid-template-columns: 1fr;
            }

            .prop-name {
                border-right: none;
                border-bottom: 1px solid var(--border);
            }

            #graph-container {
                height: 520px;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <header class="hero">
            <div class="hero-main">
                <div class="eyebrow">Knowledge Graph Citation</div>
                <h1>${title}</h1>
                <p class="hero-subtitle">A living map of entities, types, and relations rendered into a readable story.</p>
            </div>
            <div class="hero-aside">
                <button class="theme-toggle" type="button">
                    <span>Theme</span>
                    <span data-theme-label>Light</span>
                </button>
                <div class="meta-chips">
                    <div class="chip">Citation <code>${citationId}</code></div>
                    <div class="chip">${quads.length} triples</div>
                    <div class="chip">${graphData.nodes.length} nodes</div>
                </div>
            </div>
        </header>

        ${descriptionHtml}

        <nav class="tabs" role="tablist">
            <button class="tab-btn active" data-tab="table" role="tab">Table View</button>
            <button class="tab-btn" data-tab="graph" role="tab">Graph View</button>
            <button class="tab-btn" data-tab="raw" role="tab">Raw TTL</button>
        </nav>

        <section id="table" class="tab-content active">
            <div class="card table-shell">
                ${tableHtml}
            </div>
        </section>

        <section id="graph" class="tab-content">
            <div class="card graph-shell">
                <div class="graph-toolbar">
                    <select id="layout-select" class="graph-select" onchange="runLayout(this.value)">
                        <option value="breadthfirst" selected>Hierarchical</option>
                        <option value="cose">Force-Directed</option>
                        <option value="concentric">Concentric</option>
                        <option value="circle">Circle</option>
                        <option value="grid">Grid</option>
                    </select>
                    <button class="graph-btn" onclick="cy.fit(50)">Fit</button>
                    <button class="graph-btn" onclick="cy.zoom(cy.zoom() * 1.2)">Zoom In</button>
                    <button class="graph-btn" onclick="cy.zoom(cy.zoom() * 0.8)">Zoom Out</button>
                </div>
                <div id="graph-container">
                    <div class="legend">
                        <div class="legend-section">
                            <div class="legend-title">Nodes</div>
                            <div class="legend-item"><span class="legend-dot instance"></span> Instance</div>
                            <div class="legend-item"><span class="legend-dot class"></span> Class/Type</div>
                            <div class="legend-item"><span class="legend-dot literal"></span> Literal Value</div>
                        </div>
                        <div class="legend-section">
                            <div class="legend-title">Edges</div>
                            <div class="legend-item"><span class="legend-line type-edge"></span> rdf:type</div>
                            <div class="legend-item"><span class="legend-line data-edge"></span> Data Property</div>
                            <div class="legend-item"><span class="legend-line object-edge"></span> Object Property</div>
                        </div>
                    </div>
                    <div id="node-info" class="node-info"></div>
                </div>
            </div>
        </section>

        <section id="raw" class="tab-content">
            <div class="card raw-section">
                <pre>${escapeHTML(ttl)}</pre>
            </div>
        </section>
    </div>

    <script>
        const themeLabel = document.querySelector('[data-theme-label]');
        const themeToggle = document.querySelector('.theme-toggle');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        if (themeLabel) {
            themeLabel.textContent = currentTheme === 'dark' ? 'Dark' : 'Light';
        }

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
                if (btn.dataset.tab === 'graph') {
                    setTimeout(() => cy.resize(), 100);
                    setTimeout(() => cy.fit(), 200);
                }
            });
        });

        // Graph data
        const graphData = ${graphDataJson};
        function readPalette() {
            const styles = getComputedStyle(document.documentElement);
            const pick = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
            return {
                instance: pick('--instance-color', '#cc0634'),
                instanceBorder: pick('--primary-700', '#8f0424'),
                class: pick('--class-color', '#8f0424'),
                classBorder: pick('--primary-800', '#70031d'),
                literal: pick('--literal-color', '#e3768f'),
                literalBorder: pick('--primary-600', '#ad052c'),
                edgeType: pick('--type-edge-color', '#8f0424'),
                edgeData: pick('--data-edge-color', '#e3768f'),
                edgeObject: pick('--object-edge-color', '#64748b'),
                nodeText: pick('--ink', '#0f172a'),
                edgeText: pick('--muted', '#64748b'),
                selected: pick('--primary-400', '#e3768f')
            };
        }

        function getCyStyle(palette) {
            return [
                {
                    selector: 'node[nodeType=\"instance\"]',
                    style: {
                        'background-color': palette.instance,
                        'label': 'data(label)',
                        'color': palette.nodeText,
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'font-size': '10px',
                        'text-margin-y': 6,
                        'width': 32,
                        'height': 32,
                        'border-width': 2,
                        'border-color': palette.instanceBorder,
                        'text-wrap': 'ellipsis',
                        'text-max-width': 80
                    }
                },
                {
                    selector: 'node[nodeType=\"class\"]',
                    style: {
                        'background-color': palette.class,
                        'shape': 'hexagon',
                        'label': 'data(label)',
                        'color': palette.nodeText,
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'font-size': '11px',
                        'font-weight': 'bold',
                        'text-margin-y': 6,
                        'width': 40,
                        'height': 40,
                        'border-width': 3,
                        'border-color': palette.classBorder,
                        'text-wrap': 'ellipsis',
                        'text-max-width': 100
                    }
                },
                {
                    selector: 'node[nodeType=\"literal\"]',
                    style: {
                        'background-color': palette.literal,
                        'shape': 'round-rectangle',
                        'label': 'data(label)',
                        'color': palette.nodeText,
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-size': '9px',
                        'width': 'label',
                        'height': 24,
                        'padding': 8,
                        'border-width': 1,
                        'border-color': palette.literalBorder,
                        'text-wrap': 'ellipsis',
                        'text-max-width': 120
                    }
                },
                {
                    selector: 'edge[edgeType=\"type\"]',
                    style: {
                        'width': 2,
                        'line-color': palette.edgeType,
                        'line-style': 'dashed',
                        'target-arrow-color': palette.edgeType,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': palette.edgeText,
                        'text-opacity': 0.8
                    }
                },
                {
                    selector: 'edge[edgeType=\"dataProperty\"]',
                    style: {
                        'width': 2,
                        'line-color': palette.edgeData,
                        'target-arrow-color': palette.edgeData,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': palette.edgeText
                    }
                },
                {
                    selector: 'edge[edgeType=\"objectProperty\"]',
                    style: {
                        'width': 2,
                        'line-color': palette.edgeObject,
                        'target-arrow-color': palette.edgeObject,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': palette.edgeText
                    }
                },
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 4,
                        'border-color': palette.selected,
                        'background-opacity': 0.9
                    }
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'width': 4,
                        'line-color': palette.selected,
                        'target-arrow-color': palette.selected
                    }
                }
            ];
        }

        const cy = cytoscape({
            container: document.getElementById('graph-container'),
            elements: [...graphData.nodes, ...graphData.edges],
            style: getCyStyle(readPalette()),
            layout: {
                name: 'breadthfirst',
                directed: true,
                padding: 50,
                spacingFactor: 1.5,
                avoidOverlap: true,
                nodeDimensionsIncludeLabels: true
            },
            wheelSensitivity: 0.3
        });

        function updateGraphTheme() {
            cy.style().fromJson(getCyStyle(readPalette())).update();
        }

        function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            if (themeLabel) {
                themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
            }
            try {
                localStorage.setItem('kg-theme', theme);
            } catch (e) {
                // Ignore storage errors.
            }
            updateGraphTheme();
        }

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                setTheme(next);
            });
        }

        function runLayout(layoutName) {
            const layoutConfigs = {
                cose: {
                    name: 'cose',
                    animate: true,
                    animationDuration: 500,
                    nodeDimensionsIncludeLabels: true,
                    idealEdgeLength: 150,
                    nodeRepulsion: 10000,
                    nodeOverlap: 20,
                    padding: 50
                },
                breadthfirst: {
                    name: 'breadthfirst',
                    directed: true,
                    padding: 50,
                    spacingFactor: 1.5,
                    avoidOverlap: true,
                    nodeDimensionsIncludeLabels: true,
                    animate: true,
                    animationDuration: 500
                },
                concentric: {
                    name: 'concentric',
                    padding: 50,
                    minNodeSpacing: 50,
                    avoidOverlap: true,
                    nodeDimensionsIncludeLabels: true,
                    animate: true,
                    animationDuration: 500,
                    concentric: function(node) {
                        if (node.data('nodeType') === 'class') return 3;
                        if (node.data('nodeType') === 'instance') return 2;
                        return 1;
                    },
                    levelWidth: function() { return 1; }
                },
                circle: {
                    name: 'circle',
                    padding: 50,
                    avoidOverlap: true,
                    nodeDimensionsIncludeLabels: true,
                    animate: true,
                    animationDuration: 500
                },
                grid: {
                    name: 'grid',
                    padding: 50,
                    avoidOverlap: true,
                    nodeDimensionsIncludeLabels: true,
                    animate: true,
                    animationDuration: 500,
                    condense: true,
                    rows: undefined,
                    cols: undefined
                }
            };

            const config = layoutConfigs[layoutName] || layoutConfigs.breadthfirst;
            cy.layout(config).run();
            setTimeout(() => cy.fit(50), 600);
        }

        let tooltip = null;

        function showTooltip(text, x, y) {
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'cy-tooltip';
                document.body.appendChild(tooltip);
            }
            tooltip.textContent = text;
            tooltip.style.left = (x + 15) + 'px';
            tooltip.style.top = (y + 15) + 'px';
            tooltip.style.display = 'block';
        }

        function hideTooltip() {
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        }

        cy.on('mouseover', 'node', function(evt) {
            const node = evt.target;
            const data = node.data();
            const pos = evt.renderedPosition || evt.position;
            const container = document.getElementById('graph-container').getBoundingClientRect();
            showTooltip(data.fullLabel, container.left + pos.x, container.top + pos.y);
        });

        cy.on('mouseover', 'edge', function(evt) {
            const edge = evt.target;
            const data = edge.data();
            const pos = evt.renderedPosition || { x: evt.originalEvent.offsetX, y: evt.originalEvent.offsetY };
            const container = document.getElementById('graph-container').getBoundingClientRect();
            showTooltip(data.fullLabel, container.left + pos.x, container.top + pos.y);
        });

        cy.on('mouseout', 'node, edge', function() {
            hideTooltip();
        });

        const nodeInfo = document.getElementById('node-info');

        cy.on('tap', 'node', function(evt) {
            const node = evt.target;
            const data = node.data();
            let html = '<strong>' + data.fullLabel + '</strong>';
            if (data.uri) {
                html += '<br><a href=\"' + data.uri + '\" target=\"_blank\">' + data.uri + '</a>';
            }
            html += '<br><small style=\"color:var(--muted)\">Type: ' + data.nodeType + '</small>';
            nodeInfo.innerHTML = html;
            nodeInfo.classList.add('visible');
        });

        cy.on('tap', 'edge', function(evt) {
            const edge = evt.target;
            const data = edge.data();
            let html = '<strong>' + data.label + '</strong>';
            html += '<br><a href=\"' + data.fullLabel + '\" target=\"_blank\">' + data.fullLabel + '</a>';
            html += '<br><small style=\"color:var(--muted)\">Edge type: ' + data.edgeType + '</small>';
            nodeInfo.innerHTML = html;
            nodeInfo.classList.add('visible');
        });

        cy.on('tap', function(evt) {
            if (evt.target === cy) {
                nodeInfo.classList.remove('visible');
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Generates an interactive Explanation HTML Page with reproducible steps
 */
export async function generateExplanationHtml(
    explanation: Explanation,
    baseUrl: string
): Promise<string> {
    const stepsHtml = (await Promise.all(explanation.steps
        .map(async (step, index) => await generateStepHtml(step, index, explanation.id, baseUrl))))
        .join("\n");

    return `<!DOCTYPE html>
<html data-theme="light">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Explanation: ${escapeHTML(explanation.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,800&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
    <script>
        (function() {
            try {
                const stored = localStorage.getItem('kg-theme');
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
            } catch (e) {
                document.documentElement.setAttribute('data-theme', 'light');
            }
        })();
    </script>
    <style>
        :root {
            --page: #f8fafc;
            --page-accent: #eef2f6;
            --card: #ffffff;
            --card-strong: #f8fafc;
            --ink: #0f172a;
            --muted: #64748b;
            --border: rgba(15, 23, 42, 0.12);
            --primary: #cc0634;
            --primary-50: #fbebef;
            --primary-100: #f7d7df;
            --primary-200: #f1b9c6;
            --primary-300: #eb9bae;
            --primary-400: #e3768f;
            --primary-500: #db5171;
            --primary-600: #ad052c;
            --primary-700: #8f0424;
            --primary-800: #70031d;
            --primary-900: #520215;
            --accent: var(--primary);
            --accent-2: var(--primary-400);
            --accent-3: var(--primary-600);
            --success: var(--primary-500);
            --success-soft: rgba(219, 81, 113, 0.16);
            --error: var(--primary-700);
            --error-soft: rgba(143, 4, 36, 0.18);
            --shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
            --shadow-soft: 0 14px 40px rgba(15, 23, 42, 0.1);
            --grid: rgba(15, 23, 42, 0.05);
            --radius-lg: 24px;
            --radius-md: 16px;
            --radius-sm: 10px;
        }

        html[data-theme="dark"] {
            --page: #0b1120;
            --page-accent: #111827;
            --card: #0f172a;
            --card-strong: #111827;
            --ink: #e2e8f0;
            --muted: #94a3b8;
            --border: rgba(148, 163, 184, 0.18);
            --accent: var(--primary);
            --accent-2: var(--primary-300);
            --accent-3: var(--primary-200);
            --success: var(--primary-300);
            --success-soft: rgba(235, 155, 174, 0.16);
            --error: var(--primary-700);
            --error-soft: rgba(143, 4, 36, 0.18);
            --shadow: 0 30px 70px rgba(0, 0, 0, 0.45);
            --shadow-soft: 0 18px 50px rgba(0, 0, 0, 0.35);
            --grid: rgba(148, 163, 184, 0.12);
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            font-family: "Manrope", "Segoe UI", Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: var(--ink);
            background: var(--page);
            min-height: 100vh;
            position: relative;
        }

        body::before {
            content: "";
            position: fixed;
            inset: -20vmax;
            background: radial-gradient(circle at 10% 10%, rgba(204, 6, 52, 0.08), transparent 45%),
                radial-gradient(circle at 85% 20%, rgba(204, 6, 52, 0.12), transparent 50%),
                radial-gradient(circle at 70% 80%, rgba(219, 81, 113, 0.1), transparent 40%);
            opacity: 0.7;
            z-index: -2;
        }

        body::after {
            content: "";
            position: fixed;
            inset: 0;
            background-image: linear-gradient(var(--grid) 1px, transparent 1px),
                linear-gradient(90deg, var(--grid) 1px, transparent 1px);
            background-size: 48px 48px;
            opacity: 0.18;
            z-index: -1;
            pointer-events: none;
        }

        .page {
            max-width: 1200px;
            margin: 0 auto;
            padding: 36px 24px 54px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .hero {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 24px;
        }

        .hero-main {
            max-width: 720px;
        }

        .eyebrow {
            text-transform: uppercase;
            letter-spacing: 0.32em;
            font-size: 11px;
            color: var(--muted);
            font-weight: 600;
        }

        h1 {
            margin: 12px 0 10px;
            font-family: "Fraunces", "Times New Roman", serif;
            font-size: clamp(2.3rem, 3.4vw, 3.4rem);
            line-height: 1.1;
            color: var(--ink);
        }

        .hero-subtitle {
            font-size: 1.02rem;
            color: var(--muted);
            margin: 0;
        }

        .hero-aside {
            display: flex;
            flex-direction: column;
            gap: 12px;
            align-items: flex-end;
        }

        .meta-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .chip {
            background: var(--card-strong);
            border: 1px solid var(--border);
            border-radius: 999px;
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 600;
            color: var(--muted);
            box-shadow: var(--shadow-soft);
        }

        .chip code {
            font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 11px;
            color: var(--ink);
            background: transparent;
        }

        .theme-toggle {
            border: 1px solid var(--border);
            background: var(--card);
            color: var(--ink);
            padding: 8px 14px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: var(--shadow-soft);
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 20px 22px;
            box-shadow: var(--shadow-soft);
            backdrop-filter: blur(8px);
        }

        .section-label {
            font-size: 11px;
            letter-spacing: 0.24em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 12px;
            font-weight: 700;
        }

        .status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 999px;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .status.success {
            color: var(--success);
            background: var(--success-soft);
            border: 1px solid rgba(31, 157, 90, 0.3);
        }

        .status.failure {
            color: var(--error);
            background: var(--error-soft);
            border: 1px solid rgba(208, 74, 65, 0.35);
        }

        .answer-section {
            border: 2px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 22px 24px;
            background: var(--card-strong);
            box-shadow: var(--shadow);
        }

        .answer-section.success {
            border-color: rgba(31, 157, 90, 0.4);
        }

        .answer-section.failure {
            border-color: rgba(208, 74, 65, 0.4);
        }

        .answer-section h2 {
            margin: 0 0 16px 0;
            font-size: 1.2em;
            color: var(--ink);
        }

        .answer-section.success h2 {
            color: var(--success);
        }

        .answer-section.failure h2 {
            color: var(--error);
        }

        .answer-content {
            font-size: 15px;
            line-height: 1.8;
        }

        .answer-content a {
            color: var(--accent-3);
            text-decoration: none;
            background: rgba(204, 6, 52, 0.12);
            padding: 2px 6px;
            border-radius: 6px;
        }

        .answer-content a:hover {
            text-decoration: underline;
        }

        .intro {
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px 22px;
            background: var(--page-accent);
        }

        .intro h2 {
            margin: 0 0 8px 0;
            font-size: 1.1em;
            color: var(--accent);
        }

        .intro p {
            margin: 0;
            font-size: 14px;
            color: var(--muted);
        }

        .steps-section {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .steps-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
        }

        .steps-header h2 {
            margin: 0;
            font-size: 1.4em;
            color: var(--ink);
        }

        .carousel-controls {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .carousel-btn {
            border: 1px solid var(--border);
            background: var(--card);
            color: var(--ink);
            padding: 8px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .carousel-btn:hover {
            border-color: var(--accent);
            transform: translateY(-1px);
        }

        .carousel-status {
            font-size: 12px;
            color: var(--muted);
        }

        .steps-carousel {
            position: relative;
        }

        .steps-track {
            display: flex;
            gap: 18px;
            overflow-x: auto;
            padding-bottom: 8px;
            scroll-snap-type: x mandatory;
            scroll-behavior: smooth;
        }

        .steps-track::-webkit-scrollbar {
            height: 8px;
        }

        .steps-track::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 999px;
        }

        html[data-theme="dark"] .steps-track::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
        }

        .step {
            flex: 0 0 min(720px, 88vw);
            scroll-snap-align: center;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 20px 22px;
            box-shadow: var(--shadow-soft);
            position: relative;
        }

        .step::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: linear-gradient(130deg, rgba(204, 6, 52, 0.08), transparent 40%, rgba(219, 81, 113, 0.08));
            opacity: 0;
            transition: opacity 0.2s ease;
            pointer-events: none;
        }

        .step:hover::before {
            opacity: 1;
        }

        .step-header {
            display: flex;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 12px;
        }

        .step-number {
            background: var(--accent);
            color: white;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 14px;
            flex-shrink: 0;
            box-shadow: 0 10px 20px rgba(209, 98, 61, 0.25);
        }

        .step-content {
            flex: 1;
        }

        .step-description {
            font-weight: 600;
            font-size: 16px;
            margin-bottom: 6px;
        }

        .step-description p {
            margin: 0 0 8px 0;
        }

        .step-tool {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(204, 6, 52, 0.12);
            color: var(--accent-3);
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .step-params {
            margin-top: 12px;
            background: var(--page-accent);
            border-radius: var(--radius-sm);
            padding: 12px;
            font-size: 13px;
            font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            overflow-x: auto;
            border: 1px solid var(--border);
            box-shadow: none;
            margin-bottom: 0;
        }

        .step-params summary {
            cursor: pointer;
            font-weight: 600;
            color: var(--muted);
            margin-bottom: 6px;
        }

        .execute-btn {
            background: var(--accent);
            color: white;
            border: none;
            padding: 10px 18px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            margin-top: 12px;
            transition: all 0.2s ease;
            box-shadow: 0 10px 20px rgba(209, 98, 61, 0.25);
        }

        .execute-btn:hover {
            transform: translateY(-1px);
            background: #c04f2f;
        }

        .execute-btn:disabled {
            background: #b0b0b0;
            cursor: not-allowed;
            box-shadow: none;
        }

        .execute-btn.loading::after {
            content: " Loading...";
            font-weight: 600;
        }

        .step-result {
            margin-top: 16px;
            border-top: 1px solid var(--border);
            padding-top: 16px;
            display: none;
        }

        .step-result.visible {
            display: block;
        }

        .step-result h4 {
            margin: 0 0 8px 0;
            font-size: 14px;
            color: var(--success);
        }

        .step-result .markdown-result {
            background: var(--page-accent);
            padding: 12px;
            border-radius: var(--radius-sm);
            overflow-x: auto;
            font-size: 14px;
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid var(--border);
        }

        .step-result .markdown-result table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 12px;
        }

        .step-result .markdown-result th,
        .step-result .markdown-result td {
            padding: 8px 10px;
            border-bottom: 1px solid var(--border);
            text-align: left;
        }

        .step-result .markdown-result th {
            background: var(--card-strong);
        }

        .step-result.error h4 {
            color: var(--error);
        }

        .step-result.error pre {
            background: var(--error-soft);
            border: 1px solid rgba(208, 74, 65, 0.3);
            padding: 12px;
            border-radius: var(--radius-sm);
            font-size: 12px;
            white-space: pre-wrap;
        }

        .carousel-dots {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-top: 8px;
        }

        .carousel-dots .dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            border: none;
            background: rgba(0, 0, 0, 0.2);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        html[data-theme="dark"] .carousel-dots .dot {
            background: rgba(255, 255, 255, 0.2);
        }

        .carousel-dots .dot.active {
            width: 22px;
            background: var(--accent-3);
        }

        .inspection-container h1 {
            font-size: 1.6em;
            margin-bottom: 20px;
            color: var(--accent-3);
            border-bottom: 2px solid rgba(204, 6, 52, 0.2);
            padding-bottom: 8px;
        }

        .meta-info {
            font-size: 13px;
            color: var(--muted);
            margin-bottom: 16px;
            padding: 8px 12px;
            background: var(--page-accent);
            border-radius: var(--radius-sm);
            display: inline-block;
        }

        .summary-box {
            background: linear-gradient(135deg, rgba(204, 6, 52, 0.14) 0%, rgba(204, 6, 52, 0.05) 100%);
            border: 1px solid rgba(204, 6, 52, 0.35);
            border-radius: var(--radius-md);
            padding: 16px 20px;
            margin-bottom: 24px;
            font-size: 14px;
            box-shadow: var(--shadow-soft);
        }

        .summary-box .term-wrapper {
            gap: 0;
        }

        .summary-box .tech-term {
            display: none;
        }

        .intro-description {
            font-size: 14px;
            color: var(--muted);
            margin-bottom: 24px;
            padding: 12px 16px;
            background: var(--page-accent);
            border-left: 4px solid rgba(204, 6, 52, 0.3);
            border-radius: var(--radius-sm);
        }

        .section-description {
            font-size: 13px;
            color: var(--muted);
            margin-bottom: 12px;
            font-style: italic;
        }

        .empty-state {
            background: rgba(255, 193, 7, 0.1);
            border: 2px dashed rgba(255, 193, 7, 0.4);
            border-radius: var(--radius-md);
            padding: 20px;
            text-align: center;
            color: #b37500;
            margin: 20px 0;
        }

        .inspection-section {
            margin-bottom: 30px;
        }

        .inspection-section h3 {
            font-size: 1.1em;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 12px;
        }

        .search-results h2,
        .triples-results h2,
        .query-results h2 {
            font-size: 1.4em;
            color: var(--accent-3);
            margin-bottom: 16px;
            border-bottom: 2px solid rgba(204, 6, 52, 0.2);
            padding-bottom: 8px;
        }

        .results-grouped details {
            margin-bottom: 16px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 12px;
            background: var(--card);
        }

        .results-grouped summary {
            cursor: pointer;
            font-size: 15px;
            padding: 8px;
            border-radius: var(--radius-sm);
            transition: background 0.2s;
        }

        .results-grouped summary:hover {
            background: var(--page-accent);
        }

        .quads-summary {
            background: rgba(204, 6, 52, 0.12);
            border-left: 4px solid var(--accent-3);
            padding: 12px 16px;
            margin-bottom: 20px;
            border-radius: var(--radius-sm);
            font-size: 14px;
        }

        .property-grid {
            display: grid;
            grid-template-columns: minmax(160px, 30%) 1fr;
            gap: 1px;
            background: var(--border);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            overflow: hidden;
            box-shadow: var(--shadow-soft);
        }

        .prop-name {
            background: var(--card-strong);
            padding: 12px 16px;
            font-weight: 700;
            font-size: 13px;
            color: var(--muted);
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 4px;
            word-break: break-word;
        }

        .prop-values {
            background: var(--card);
            padding: 12px 16px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: flex-start;
        }

        .prop-values .match-conn,
        .prop-values .match-text {
            flex-basis: 100%;
        }

        .result-label {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .result-uri {
            color: var(--muted);
            font-size: 11px;
            font-weight: 500;
            word-break: break-all;
        }

        .match-conn {
            color: var(--muted);
            font-size: 12px;
        }

        .match-prop {
            color: var(--ink);
            font-weight: 600;
        }

        .match-text {
            font-size: 14px;
            font-weight: 600;
            color: var(--ink);
        }

        .value-tag {
            background: rgba(204, 6, 52, 0.12);
            color: var(--accent-3);
            padding: 4px 12px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 600;
            border: 1px solid rgba(204, 6, 52, 0.2);
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-block;
        }

        .value-tag:hover {
            background: var(--accent-3);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 10px 20px rgba(204, 6, 52, 0.2);
        }

        .value-literal {
            background: rgba(219, 81, 113, 0.12);
            color: var(--accent-2);
            border-color: rgba(219, 81, 113, 0.25);
        }

        .value-literal:hover {
            background: var(--accent-2);
            color: #fff;
        }

        .value-more {
            background: transparent;
            color: var(--muted);
            border: 1px dashed var(--border);
            font-style: italic;
        }

        .value-more:hover {
            background: transparent;
            color: var(--muted);
            transform: none;
            box-shadow: none;
        }

        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
            color: var(--muted);
            font-size: 13px;
        }

        @media (max-width: 720px) {
            .page {
                padding: 28px 16px 40px;
            }

            .hero {
                align-items: flex-start;
            }

            .hero-aside {
                align-items: flex-start;
            }

            .steps-header {
                align-items: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <header class="hero">
            <div class="hero-main">
                <div class="eyebrow">Explanation Trace</div>
                <h1>${escapeHTML(explanation.title)}</h1>
                <p class="hero-subtitle">A transparent, step-by-step journey from question to answer.</p>
            </div>
            <div class="hero-aside">
                <button class="theme-toggle" type="button">
                    <span>Theme</span>
                    <span data-theme-label>Light</span>
                </button>
                <div class="meta-chips">
                    <div class="chip">ID <code>${explanation.id}</code></div>
                    <div class="chip">${explanation.steps.length} steps</div>
                    <div class="chip">${explanation.createdAt.toLocaleString()}</div>
                </div>
                <span class="status ${explanation.found ? "success" : "failure"}">
                    ${explanation.found ? "Found" : "Not found"}
                </span>
            </div>
        </header>

        <section class="answer-section ${explanation.found ? "success" : "failure"}">
            <h2>Answer</h2>
            <div class="answer-content">
                ${await marked.parse(explanation.answer)}
            </div>
        </section>

        <section class="intro">
            <h2>Verification</h2>
            <p>
                These steps are a replayable trail of evidence. Run a step to verify the exact query and result
                that produced the answer.
            </p>
        </section>

        <section class="steps-section">
            <div class="steps-header">
                <div>
                    <div class="section-label">Steps Carousel</div>
                    <h2>Follow the Trace</h2>
                </div>
                <div class="carousel-controls">
                    <button class="carousel-btn" data-carousel="prev">Prev</button>
                    <button class="carousel-btn" data-carousel="next">Next</button>
                    <span class="carousel-status" data-carousel-status></span>
                </div>
            </div>
            <div class="steps-carousel">
                <div class="steps-track">
                    ${stepsHtml}
                </div>
            </div>
            <div class="carousel-dots"></div>
        </section>

        <script src=\"https://cdn.jsdelivr.net/npm/marked/marked.min.js\"></script>
        <footer>
            Generated by MCP Knowledge Graph Server •
            <a href=\"${baseUrl}\">Back to server</a>
        </footer>
    </div>

    <script>
        const themeLabel = document.querySelector('[data-theme-label]');
        const themeToggle = document.querySelector('.theme-toggle');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        if (themeLabel) {
            themeLabel.textContent = currentTheme === 'dark' ? 'Dark' : 'Light';
        }

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                if (themeLabel) {
                    themeLabel.textContent = next === 'dark' ? 'Dark' : 'Light';
                }
                try {
                    localStorage.setItem('kg-theme', next);
                } catch (e) {
                    // Ignore storage errors.
                }
            });
        }

        const stepsTrack = document.querySelector('.steps-track');
        const steps = Array.from(document.querySelectorAll('.step'));
        const dotsContainer = document.querySelector('.carousel-dots');
        const statusLabel = document.querySelector('[data-carousel-status]');
        const prevBtn = document.querySelector('[data-carousel="prev"]');
        const nextBtn = document.querySelector('[data-carousel="next"]');
        let currentIndex = 0;
        let scrollTimer = null;

        function updateDots() {
            if (!dotsContainer) return;
            const dots = Array.from(dotsContainer.querySelectorAll('.dot'));
            dots.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentIndex);
            });
        }

        function updateStatus() {
            if (statusLabel) {
                statusLabel.textContent = steps.length ? ('Step ' + (currentIndex + 1) + ' of ' + steps.length) : 'No steps';
            }
        }

        function goToStep(index, smooth) {
            if (!steps.length) return;
            const nextIndex = Math.max(0, Math.min(index, steps.length - 1));
            currentIndex = nextIndex;
            steps[nextIndex].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
            updateDots();
            updateStatus();
        }

        function buildDots() {
            if (!dotsContainer) return;
            dotsContainer.innerHTML = steps.map((_, index) => {
                return '<button class=\"dot\" data-index=\"' + index + '\" aria-label=\"Go to step ' + (index + 1) + '\"></button>';
            }).join('');
            dotsContainer.addEventListener('click', (event) => {
                const target = event.target;
                if (target && target.dataset && target.dataset.index) {
                    goToStep(parseInt(target.dataset.index, 10), true);
                }
            });
        }

        function updateFromScroll() {
            if (!stepsTrack || !steps.length) return;
            const trackRect = stepsTrack.getBoundingClientRect();
            const centerX = trackRect.left + trackRect.width / 2;
            let closestIndex = 0;
            let closestDistance = Infinity;
            steps.forEach((step, index) => {
                const rect = step.getBoundingClientRect();
                const stepCenter = rect.left + rect.width / 2;
                const distance = Math.abs(centerX - stepCenter);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestIndex = index;
                }
            });
            currentIndex = closestIndex;
            updateDots();
            updateStatus();
        }

        if (stepsTrack) {
            stepsTrack.addEventListener('scroll', () => {
                if (scrollTimer) {
                    clearTimeout(scrollTimer);
                }
                scrollTimer = setTimeout(updateFromScroll, 100);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => goToStep(currentIndex - 1, true));
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => goToStep(currentIndex + 1, true));
        }

        buildDots();
        updateStatus();
        updateDots();

        async function executeStep(explanationId, stepIndex, button) {
            const stepEl = button.closest('.step');
            const resultEl = stepEl.querySelector('.step-result');
            const mdContent = resultEl.querySelector('.markdown-result');
            const preContent = resultEl.querySelector('pre');
            const resultHeader = resultEl.querySelector('h4');

            button.disabled = true;
            button.classList.add('loading');
            button.textContent = 'Running...';

            mdContent.style.display = 'none';
            preContent.style.display = 'none';

            try {
                const response = await fetch(\`${baseUrl}/explain/\${explanationId}/execute/\${stepIndex}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (data.success) {
                    resultHeader.textContent = 'Result';
                    mdContent.innerHTML = marked.parse(data.result);
                    mdContent.style.display = 'block';
                    resultEl.classList.remove('error');
                } else {
                    resultHeader.textContent = 'Error';
                    preContent.textContent = data.error;
                    preContent.style.display = 'block';
                    resultEl.classList.add('error');
                }

                resultEl.classList.add('visible');
            } catch (error) {
                resultHeader.textContent = 'Error';
                preContent.textContent = error.message;
                preContent.style.display = 'block';
                resultEl.classList.add('error');
                resultEl.classList.add('visible');
            } finally {
                button.disabled = false;
                button.classList.remove('loading');
                button.textContent = 'Run Step';
            }
        }
    </script>
</body>
</html>`;
}

/**
 * Generates HTML for a single explanation step
 */
async function generateStepHtml(
    step: ExplanationStep,
    index: number,
    explanationId: string,
    baseUrl: string
): Promise<string> {
    const paramsJson = JSON.stringify(step.toolParams, null, 2);

    return `
        <div class="step" data-step="${index}">
            <div class="step-header">
                <div class="step-number">${index + 1}</div>
                <div class="step-content">
                    <div class="step-description">${await marked.parse(step.description)}</div>
                    <span class="step-tool">${step.toolName}</span>
                </div>
            </div>
            
            <details class="step-params">
                <summary>Parameters</summary>
                <pre>${escapeHTML(paramsJson)}</pre>
            </details>
            
            <button class="execute-btn" onclick=\"executeStep('${explanationId}', ${index}, this)\">
                Run Step
            </button>
            
            <div class=\"step-result\">
                <h4>Result</h4>
                <div class=\"markdown-result\"></div>
                <pre style=\"display:none\"></pre>
            </div>
        </div>`;
}
