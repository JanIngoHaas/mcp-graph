Start = Path

Path
  = head:Segment tail:(_ "." _ Segment)* {
      return [head, ...tail.map(r => r[3])];
  }

Segment
  = FullURI
  / PrefixedName
  / Identifier

FullURI
  = "<" chars:[^>]+ ">" { return "<" + chars.join("") + ">"; }

PrefixedName
  = prefix:Identifier ":" local:LocalName { return prefix + ":" + local; }

Identifier
  = chars:[a-zA-Z0-9_]+ { return chars.join(""); }

LocalName
  = chars:[a-zA-Z0-9_\-]+ { return chars.join(""); }

_ "whitespace"
  = [ \t\n\r]*
