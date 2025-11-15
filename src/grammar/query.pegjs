Query = Expression

Expression = OrExpression

OrExpression
  = left:AndExpression _ OR _ right:OrExpression {
    return { type: 'or', left, right };
  }
  / AndExpression

AndExpression
  = left:Factor _ AND _ right:AndExpression {  
    return { type: 'and', left, right };
  }
  / Factor

Factor
  = QuotedString
  / ParenExpression
  / ImplicitAndSequence
  / SingleWord

ImplicitAndSequence
  = first:WORD _ second:WORD rest:(_ word:WORD { return word; })* {
    return { type: 'words', words: [first, second, ...rest] };
  }

SingleWord = word:WORD { return { type: 'term', value: word }; }

QuotedString = '"' content:[^"]* '"' { return { type: 'term', value: content.join('') }; }

ParenExpression = "(" _ expr:Expression _ ")" { return expr; }

// Explicit tokens with word boundary checking
AND = "AND" !WordChar _
OR = "OR" !WordChar _
WORD = !("AND" !WordChar / "OR" !WordChar) chars:WordChar+ { return chars.join(''); }
WordChar = [^ \t\n\r"()]
_ = [ \t\n\r]*