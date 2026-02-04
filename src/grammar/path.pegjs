Start = Path

Path
  = head:Segment tail:(_ "->" _ Segment)* {
      return [head, ...tail.map(r => r[3])];
  }

Segment
  = FullURI
  / PrefixedName

FullURI
  = prefix:("http://" / "https://") rest:UriChar+ { return prefix + rest.join(""); }

PrefixedName
  = prefix:Identifier ":" local:LocalName { return prefix + ":" + local; }

Identifier
  = chars:[a-zA-Z0-9_]+ { return chars.join(""); }

LocalName
  = chars:LocalChar+ { return chars.join(""); }

LocalChar
  = !("->") c:[a-zA-Z0-9_\-] { return c; }

UriChar
  = !("->") c:[^ \t\n\r] { return c; }

_ "whitespace"
  = [ \t\n\r]*
