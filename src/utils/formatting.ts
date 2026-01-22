import { Quad } from "@rdfjs/types";
import { PrefixManager } from "./PrefixManager.js";
import { Writer } from "n3";
import { marked } from "marked";
import { formatLocalName, getReadableName, formatSparqlValue, resolveLabel, enrichTextWithLinks } from "./uriUtils.js";

/**
 * Escapes HTML special characters
 */
export function escapeHTML(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Renders an RDF Term as HTML with clickable links for NamedNodes
 */
export function renderTermHTML(term: any): string {
    if (term.termType === "NamedNode") {
        const label = escapeHTML(term.value);
        return `<a href="${term.value}" target="_blank">${label}</a>`;
    } else if (term.termType === "Literal") {
        let label = `"${escapeHTML(term.value)}"`;
        if (term.language) {
            label += `<span style="color: gray">@${escapeHTML(term.language)}</span>`;
        } else if (term.datatype && term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string") {
            const datatype = escapeHTML(term.datatype.value);
            label += ` <small title="${datatype}" style="color: gray">^^${datatype.split(/[#/]/).pop()}</small>`;
        }
        return label;
    }
    return escapeHTML(term.value);
}

/**
 * Generates a Markdown table from Quads
 */
export function formatQuadsToMarkdown(quads: Quad[], compressed: boolean): string {
    if (quads.length === 0) return "No triples found.";

    const prefixManager = PrefixManager.getInstance();

    // 1. Organize data
    const entityData = new Map<string, Map<string, Set<string>>>();
    const entityTypes = new Map<string, Set<string>>();

    quads.forEach(quad => {
        const s = quad.subject.value;
        const p = quad.predicate.value;
        const o = quad.object.value;

        // Store Entity Properties
        if (!entityData.has(s)) entityData.set(s, new Map());
        const props = entityData.get(s)!;
        if (!props.has(p)) props.set(p, new Set());
        // Escape pipes for Markdown table cells
        props.get(p)!.add(o.replace(/\|/g, '\\|'));

        // Store Types
        if (p === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            if (!entityTypes.has(s)) entityTypes.set(s, new Set());
            entityTypes.get(s)!.add(o);
        }
    });

    // 2. Group subjects by Type
    const typeGroups = new Map<string, Set<string>>(); // Type -> Set<Subject>
    const uncategorized = new Set<string>();

    for (const s of entityData.keys()) {
        const types = entityTypes.get(s);
        if (types && types.size > 0) {
            types.forEach(t => {
                if (!typeGroups.has(t)) typeGroups.set(t, new Set());
                typeGroups.get(t)!.add(s);
            });
        } else {
            uncategorized.add(s);
        }
    }

    // 3. Build Markdown
    let md = `found ${quads.length} triples\n\n`;

    const generateTable = (typeName: string, subjects: Set<string>) => {
        // Collect all predicates for these subjects to define columns
        const predicates = new Set<string>();
        subjects.forEach(s => {
            const props = entityData.get(s)!;
            for (const p of props.keys()) {
                predicates.add(p);
            }
        });

        // Sort predicates for consistent column order
        const sortedPredicates = Array.from(predicates).sort();

        // Header
        let table = `<details><summary>Type: <a href="${typeName}">${formatLocalName(typeName)}</a></summary>\n\n`;
        table += `| Entity | ${sortedPredicates.map(p => formatLocalName(p)).join(' | ')} |\n`; // Format headers nicely
        table += `|---|${sortedPredicates.map(() => '---').join('|')}|\n`;

        // Rows
        subjects.forEach(s => {
            let row = `| ${s} |`; // Subject URI

            for (const p of sortedPredicates) {
                const props = entityData.get(s)!;
                const values = props.get(p);
                const cellContent = values ? Array.from(values).join(', ') : '';
                row += ` ${cellContent} |`;
            }
            table += row + '\n';
        });
        table += '\n';
        table += '</details>\n\n';
        return table;
    };

    // Iterate groups (sort by type name for consistency)
    const sortedTypes = Array.from(typeGroups.keys()).sort();
    for (const typeUri of sortedTypes) {
        md += generateTable(typeUri, typeGroups.get(typeUri)!);
    }

    if (uncategorized.size > 0) {
        md += generateTable("Uncategorized", uncategorized);
    }

    if (compressed) {
        // Model view: use prefixes to save tokens
        return prefixManager.compressTextWithPrefixes(md, true);
    } else {
        // User view: use beautiful [Label](Link) formatting
        return enrichTextWithLinks(md);
    }
}

/**
 * Generates regular TTL from Quads
 */
export async function formatQuadsToTtl(quads: Quad[]): Promise<string> {
    const prefixManager = PrefixManager.getInstance();
    const writer = new Writer({ prefixes: prefixManager.getPrefixMap() });
    writer.addQuads(quads);

    return new Promise<string>((resolve, reject) => {
        writer.end((err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

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

    // Generate Markdown and render to HTML
    const markdown = formatQuadsToMarkdown(quads, false);
    const markdownHtml = await marked.parse(markdown);

    let descriptionHtml = '';
    if (options?.description) {
        const descriptionRendered = await marked.parse(options.description);
        descriptionHtml = `
    <div class="description">
        ${descriptionRendered}
    </div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
    <title>${title} - ${citationId}</title>
    <script src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
    <style>
        :root {
            --primary: #0066cc;
            --primary-light: #e6f0ff;
            --bg: #ffffff;
            --bg-secondary: #f7f7f7;
            --text: #333333;
            --text-muted: #666666;
            --border: #e0e0e0;
            --shadow: rgba(0,0,0,0.1);
            /* Node colors */
            --instance-color: #4a90d9;
            --class-color: #9b59b6;
            --literal-color: #2ecc71;
            /* Edge colors */
            --type-edge-color: #9b59b6;
            --data-edge-color: #27ae60;
            --object-edge-color: #888888;
        }
        
        * { box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            padding: 20px; 
            line-height: 1.6; 
            color: var(--text); 
            max-width: 1400px; 
            margin: 0 auto; 
            background: var(--bg);
        }
        
        h1 { 
            margin-bottom: 10px; 
            font-size: 1.8em;
        }
        
        .description { 
            background: var(--primary-light); 
            padding: 15px; 
            border: 4px solid var(--primary); 
            margin-bottom: 20px; 
            border-radius: 4px;
        }
        
        .meta { 
            color: var(--text-muted); 
            margin-bottom: 20px; 
            font-size: 14px; 
        }
        
        /* Tab styles */
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 0;
            border-bottom: 2px solid var(--border);
        }
        
        .tab-btn {
            padding: 12px 24px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: var(--text-muted);
            border-bottom: 2px solid transparent;
            margin-bottom: -2px;
            transition: all 0.2s ease;
        }
        
        .tab-btn:hover {
            color: var(--primary);
            background: var(--primary-light);
        }
        
        .tab-btn.active {
            color: var(--primary);
            border-bottom-color: var(--primary);
        }
        
        .tab-content {
            display: none;
            padding: 20px 0;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* Graph styles */
        .graph-wrapper {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .graph-toolbar {
            display: flex;
            gap: 8px;
            padding: 10px;
            background: white;
            border: 1px solid var(--border);
            border-radius: 8px;
            box-shadow: 0 1px 3px var(--shadow);
        }
        
        #graph-container {
            width: 100%;
            height: 600px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: linear-gradient(135deg, #fafbfc 0%, #f0f2f5 100%);
            position: relative;
        }
        
        .graph-btn {
            padding: 8px 12px;
            border: 1px solid var(--border);
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
            box-shadow: 0 1px 3px var(--shadow);
        }
        
        .graph-btn:hover {
            background: var(--primary-light);
            border-color: var(--primary);
        }
        
        .graph-select {
            padding: 8px 12px;
            border: 1px solid var(--border);
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            box-shadow: 0 1px 3px var(--shadow);
            outline: none;
            position: relative;
            z-index: 101;
            -webkit-appearance: menulist;
            appearance: menulist;
        }
        
        .graph-select:focus {
            border-color: var(--primary);
        }
        
        .node-info {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 2px 8px var(--shadow);
            max-width: 400px;
            font-size: 13px;
            display: none;
            z-index: 10;
        }
        
        .node-info.visible {
            display: block;
        }
        
        .node-info strong {
            display: block;
            margin-bottom: 4px;
            color: var(--primary);
        }
        
        .node-info a {
            word-break: break-all;
        }
        
        .legend {
            position: absolute;
            top: 10px;
            left: 10px;
            background: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 1px 4px var(--shadow);
            font-size: 11px;
            z-index: 10;
            max-width: 180px;
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
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 6px;
        }
        
        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 3px 0;
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
        
        /* Tooltip for nodes */
        .cy-tooltip {
            position: absolute;
            background: rgba(0,0,0,0.85);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            max-width: 300px;
            word-wrap: break-word;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        
        /* Table styles */
        table { 
            border-collapse: collapse; 
            width: 100%; 
            box-shadow: 0 1px 3px var(--shadow); 
            border-radius: 8px;
            overflow: hidden;
        }
        
        th, td { 
            border: 1px solid var(--border); 
            padding: 12px; 
            text-align: left; 
        }
        
        th { 
            background-color: var(--bg-secondary); 
            font-weight: 600; 
            position: sticky; 
            top: 0; 
        }
        
        tr:nth-child(even) { background-color: #fcfcfc; }
        tr:hover { background-color: var(--primary-light); }
        
        a { text-decoration: none; color: var(--primary); }
        a:hover { text-decoration: underline; }
        
        /* Raw TTL styles */
        .raw-section { 
            background: var(--bg-secondary); 
            padding: 20px; 
            border: 1px solid var(--border); 
            border-radius: 8px; 
            overflow-x: auto; 
        }
        
        pre { 
            margin: 0; 
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace; 
            font-size: 13px; 
            white-space: pre-wrap;
            word-break: break-word;
        }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div class="meta">Citation ID: <code>${citationId}</code> &bull; Triples: ${quads.length} &bull; Nodes: ${graphData.nodes.length}</div>
    ${descriptionHtml}
    
    <div class="tabs">
        <button class="tab-btn active" data-tab="table">📋 Table View</button>
        <button class="tab-btn" data-tab="graph">📊 Graph View</button>
        <button class="tab-btn" data-tab="raw">📄 Raw TTL</button>
    </div>
    
    <div id="graph" class="tab-content">
        <div class="graph-wrapper">
            <div class="graph-toolbar">
                <select id="layout-select" class="graph-select" onchange="runLayout(this.value)">
                    <option value="breadthfirst" selected>Hierarchical</option>
                    <option value="cose">Force-Directed</option>
                    <option value="concentric">Concentric</option>
                    <option value="circle">Circle</option>
                    <option value="grid">Grid</option>
                </select>
                <button class="graph-btn" onclick="cy.fit(50)">🔍 Fit</button>
                <button class="graph-btn" onclick="cy.zoom(cy.zoom() * 1.2)">➕ Zoom In</button>
                <button class="graph-btn" onclick="cy.zoom(cy.zoom() * 0.8)">➖ Zoom Out</button>
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
    </div>
    
    <div id="table" class="tab-content active">
        <div class="markdown-table-container">
            ${markdownHtml}
        </div>
    </div>
    
    <div id="raw" class="tab-content">
        <div class="raw-section">
            <pre>${escapeHTML(ttl)}</pre>
        </div>
    </div>

    <script>
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
                if (btn.dataset.tab === 'graph') {
                    // Slight delay to allow display:block to take effect before resize
                    setTimeout(() => cy.resize(), 100);
                    setTimeout(() => cy.fit(), 200);
                }
            });
        });
        
        // Graph data
        const graphData = ${graphDataJson};
        
        // Initialize Cytoscape
        const cy = cytoscape({
            container: document.getElementById('graph-container'),
            elements: [...graphData.nodes, ...graphData.edges],
            style: [
                // Instance nodes (blue circles)
                {
                    selector: 'node[nodeType="instance"]',
                    style: {
                        'background-color': '#4a90d9',
                        'label': 'data(label)',
                        'color': '#333',
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'font-size': '10px',
                        'text-margin-y': 6,
                        'width': 32,
                        'height': 32,
                        'border-width': 2,
                        'border-color': '#2c5aa0',
                        'text-wrap': 'ellipsis',
                        'text-max-width': 80
                    }
                },
                // Class nodes (purple hexagons)
                {
                    selector: 'node[nodeType="class"]',
                    style: {
                        'background-color': '#9b59b6',
                        'shape': 'hexagon',
                        'label': 'data(label)',
                        'color': '#333',
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'font-size': '11px',
                        'font-weight': 'bold',
                        'text-margin-y': 6,
                        'width': 40,
                        'height': 40,
                        'border-width': 3,
                        'border-color': '#7d3c98',
                        'text-wrap': 'ellipsis',
                        'text-max-width': 100
                    }
                },
                // Literal nodes (green rounded rectangles)
                {
                    selector: 'node[nodeType="literal"]',
                    style: {
                        'background-color': '#2ecc71',
                        'shape': 'round-rectangle',
                        'label': 'data(label)',
                        'color': '#333',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'font-size': '9px',
                        'width': 'label',
                        'height': 24,
                        'padding': 8,
                        'border-width': 1,
                        'border-color': '#27ae60',
                        'text-wrap': 'ellipsis',
                        'text-max-width': 120
                    }
                },
                // rdf:type edges (purple, dashed)
                {
                    selector: 'edge[edgeType="type"]',
                    style: {
                        'width': 2,
                        'line-color': '#9b59b6',
                        'line-style': 'dashed',
                        'target-arrow-color': '#9b59b6',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': '#7d3c98',
                        'text-opacity': 0.8
                    }
                },
                // Data property edges (green, to literals)
                {
                    selector: 'edge[edgeType="dataProperty"]',
                    style: {
                        'width': 2,
                        'line-color': '#27ae60',
                        'target-arrow-color': '#27ae60',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': '#1e8449'
                    }
                },
                // Object property edges (gray, between instances)
                {
                    selector: 'edge[edgeType="objectProperty"]',
                    style: {
                        'width': 2,
                        'line-color': '#7f8c8d',
                        'target-arrow-color': '#7f8c8d',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'label': 'data(label)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -8,
                        'color': '#566573'
                    }
                },
                // Selected state
                {
                    selector: 'node:selected',
                    style: {
                        'border-width': 4,
                        'border-color': '#e74c3c',
                        'background-opacity': 0.9
                    }
                },
                {
                    selector: 'edge:selected',
                    style: {
                        'width': 4,
                        'line-color': '#e74c3c',
                        'target-arrow-color': '#e74c3c'
                    }
                }
            ],
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
                        // Class nodes in center, then instances, then literals
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
        
        // Tooltip element
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
        
        // Show tooltip on hover
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
        
        // Node info panel on click
        const nodeInfo = document.getElementById('node-info');
        
        cy.on('tap', 'node', function(evt) {
            const node = evt.target;
            const data = node.data();
            let html = '<strong>' + data.fullLabel + '</strong>';
            if (data.uri) {
                html += '<br><a href="' + data.uri + '" target="_blank">' + data.uri + '</a>';
            }
            html += '<br><small style="color:#888">Type: ' + data.nodeType + '</small>';
            nodeInfo.innerHTML = html;
            nodeInfo.classList.add('visible');
        });
        
        cy.on('tap', 'edge', function(evt) {
            const edge = evt.target;
            const data = edge.data();
            let html = '<strong>' + data.label + '</strong>';
            html += '<br><a href="' + data.fullLabel + '" target="_blank">' + data.fullLabel + '</a>';
            html += '<br><small style="color:#888">Edge type: ' + data.edgeType + '</small>';
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

import { Explanation, ExplanationStep } from "./ExplanationDatabase.js";

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
<html>
<head>
    <title>Explanation: ${escapeHTML(explanation.title)}</title>
    <style>
        :root {
            --primary: #0066cc;
            --primary-light: #e6f0ff;
            --success: #28a745;
            --success-light: #d4edda;
            --bg: #ffffff;
            --bg-secondary: #f7f7f7;
            --text: #333333;
            --text-muted: #666666;
            --border: #e0e0e0;
            --shadow: rgba(0,0,0,0.1);
        }
        
        * { box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            padding: 20px; 
            line-height: 1.6; 
            color: var(--text); 
            max-width: 900px; 
            margin: 0 auto; 
            background: var(--bg);
        }
        
        h1 { 
            margin-bottom: 10px; 
            font-size: 1.8em;
            color: var(--primary);
        }
        
        .meta { 
            color: var(--text-muted); 
            margin-bottom: 30px; 
            font-size: 14px; 
        }
        
        .intro {
            background: var(--primary-light);
            border: 2px solid var(--primary);
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 30px;
        }
        
        .intro h2 {
            margin: 0 0 8px 0;
            font-size: 1.1em;
            color: var(--primary);
        }
        
        .intro p {
            margin: 0;
            font-size: 14px;
        }
        
        .answer-section {
            background: white;
            border: 2px solid var(--success);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 8px var(--shadow);
        }
        
        .answer-section h2 {
            margin: 0 0 16px 0;
            font-size: 1.2em;
            color: var(--success);
        }
        
        .answer-content {
            font-size: 15px;
            line-height: 1.8;
        }
        
        .answer-content a {
            color: var(--primary);
            text-decoration: none;
            background: var(--primary-light);
            padding: 2px 6px;
            border-radius: 4px;
        }
        
        .answer-content a:hover {
            text-decoration: underline;
        }
        
        .steps {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .step {
            background: white;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px var(--shadow);
            position: relative;
        }
        
        .step-header {
            display: flex;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 12px;
        }
        
        .step-number {
            background: var(--primary);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            flex-shrink: 0;
        }
        
        .step-content {
            flex: 1;
        }
        
        .step-description {
            font-weight: 600;
            font-size: 16px;
            margin-bottom: 4px;
        }
        
        .step-tool {
            display: inline-block;
            background: var(--bg-secondary);
            color: var(--text-muted);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: monospace;
        }
        
        .citation-link {
            display: inline-block;
            margin-left: 12px;
            font-size: 12px;
            color: var(--success);
            text-decoration: none;
            padding: 2px 8px;
            background: var(--success-light);
            border-radius: 4px;
        }
        
        .citation-link:hover {
            text-decoration: underline;
        }
        
        .step-params {
            margin-top: 12px;
            background: var(--bg-secondary);
            border-radius: 4px;
            padding: 12px;
            font-size: 13px;
            font-family: monospace;
            overflow-x: auto;
        }
        
        .step-params summary {
            cursor: pointer;
            font-weight: 500;
            color: var(--text-muted);
        }
        
        .execute-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-top: 12px;
            transition: all 0.2s;
        }
        
        .execute-btn:hover {
            background: #0052a3;
        }
        
        .execute-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        .execute-btn.loading::after {
            content: " ⏳";
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
            background: var(--bg-secondary);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            font-size: 14px;
            max-height: 500px;
            overflow-y: auto;
        }

        .step-result .markdown-result table {
            font-size: 12px;
        }
        
        .step-result.error pre {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            padding: 12px;
            border-radius: 4px;
            font-size: 12px;
            white-space: pre-wrap;
        }
        
        .connector {
            width: 2px;
            height: 20px;
            background: var(--border);
            margin-left: 35px;
        }
        
        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
            color: var(--text-muted);
            font-size: 13px;
        }
    </style>
</head>
<body>
    <h1>🔍 ${escapeHTML(explanation.title)}</h1>
    <div class="meta">
        Explanation ID: <code>${explanation.id}</code> • 
        Steps: ${explanation.steps.length} • 
        Created: ${explanation.createdAt.toLocaleString()}
    </div>
    
    <div class="answer-section">
        <h2>📝 Answer</h2>
        <div class="answer-content">
            ${await marked.parse(explanation.answer)}
        </div>
    </div>
    
    <div class="intro">
        <h2>🔬 Verification Steps</h2>
        <p>
            Below are the steps the AI took to arrive at this answer. 
            Click <strong>"▶ Execute Step"</strong> on any step to re-run it and see the actual results from the knowledge graph.
            This allows you to verify (nachvollziehen) what the AI did.
        </p>
    </div>
    
    <div class="steps">
        ${stepsHtml}
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <footer>
        Generated by MCP Knowledge Graph Server • 
        <a href="${baseUrl}">Back to server</a>
    </footer>
    
    <script>
        async function executeStep(explanationId, stepIndex, button) {
            const stepEl = button.closest('.step');
            const resultEl = stepEl.querySelector('.step-result');
            const mdContent = resultEl.querySelector('.markdown-result');
            const preContent = resultEl.querySelector('pre');
            const resultHeader = resultEl.querySelector('h4');
            
            button.disabled = true;
            button.classList.add('loading');
            button.textContent = 'Executing...';

            mdContent.style.display = 'none';
            preContent.style.display = 'none';
            
            try {
                const response = await fetch(\`${baseUrl}/explain/\${explanationId}/execute/\${stepIndex}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    resultHeader.textContent = '✓ Result:';
                    mdContent.innerHTML = marked.parse(data.result);
                    mdContent.style.display = 'block';
                    resultEl.classList.remove('error');
                } else {
                    resultHeader.textContent = '✗ Error:';
                    preContent.textContent = data.error;
                    preContent.style.display = 'block';
                    resultEl.classList.add('error');
                }
                
                resultEl.classList.add('visible');
            } catch (error) {
                resultHeader.textContent = '✗ Error:';
                preContent.textContent = error.message;
                preContent.style.display = 'block';
                resultEl.classList.add('error');
                resultEl.classList.add('visible');
            } finally {
                button.disabled = false;
                button.classList.remove('loading');
                button.textContent = '▶ Execute Step';
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
        <div class="step">
            <div class="step-header">
                <div class="step-number">${index + 1}</div>
                <div class="step-content">
                    <div class="step-description">${await marked.parse(step.description)}</div>
                    <span class="step-tool">${step.toolName}</span>
                </div>
            </div>
            
            <details class="step-params">
                <summary>View parameters</summary>
                <pre>${escapeHTML(paramsJson)}</pre>
            </details>
            
            <button class="execute-btn" onclick="executeStep('${explanationId}', ${index}, this)">
                ▶ Execute Step
            </button>
            
            <div class="step-result">
                <h4>Result:</h4>
                <div class="markdown-result"></div>
                <pre style="display:none"></pre>
            </div>
        </div>`;
}
