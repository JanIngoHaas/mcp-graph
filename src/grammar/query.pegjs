Query
  = OrExpression

OrExpression
  = left:AndExpression _ "OR"i _ right:OrExpression {
    return { type: 'or', left, right };
  }
  / AndExpression

AndExpression  
  = left:Primary _ "AND"i _ right:AndExpression {
    return { type: 'and', left, right };
  }
  / Primary

Primary
  = QuotedString
  / ParenExpression
  / WordSequence

QuotedString
  = '"' content:[^"]* '"' {
    return { type: 'term', value: content.join('') };
  }

ParenExpression
  = "(" _ expr:OrExpression _ ")" {
    return expr;
  }

WordSequence
  = words:Word|1.., _| {
    if (words.length === 1) {
      return { type: 'term', value: words[0] };
    }
    // Multiple unquoted words become AND (all words must appear)
    return { type: 'words', words: words };
  }

Word
  = [a-zA-Z0-9_-]+ { return text(); }

_
  = [ \t\n\r]*