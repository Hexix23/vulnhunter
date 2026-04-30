function compile(name, source, flags) {
  try {
    const re = new RegExp(source, flags);
    print(name + ': OK ' + re.source + '/' + re.flags);
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

compile('exact script short alias', '\\p{sc=Grek}', 'v');
compile('exact script long alias', '\\p{Script=Greek}', 'v');
compile('exact binary property of strings', '\\p{Basic_Emoji}', 'v');

compile('loose property lowercase', '\\p{script=Greek}', 'v');
compile('loose value lowercase', '\\p{Script=greek}', 'v');
compile('loose property missing underscore', '\\p{ScriptExtensions=Greek}', 'v');
compile('loose binary missing underscore', '\\p{BasicEmoji}', 'v');
compile('loose binary lowercase', '\\p{basic_emoji}', 'v');
