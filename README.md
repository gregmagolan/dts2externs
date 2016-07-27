# dts2externs
Parse typescript d.ts files and output google closure compiler externs file

_Note: this is a very crude piece of software :grin: The output is messy and the only thing it does is prevent the google closure compiler from renaming external references in your code._

# Installation

### Local

```
$ npm install dts2externs --save-dev
```

```
$ node node_modules/dts2externs/dist/bin.js -h
```

### Global
```
$ npm install -g dts2externs
```

```
$ dts2externs -h
```

# Usage

### In _npm_ build scripts
For projects using `typings` plugin. Add new script in your `package.json`:
```json
{
  "scripts": {
    "externs": "dts2externs typings/index.d.ts -o externs.js",
  }
}
```

### In _gulp_ build scripts
For projects using `typings` plugin. Include `dts2externs` `gulp` plugin:
```javascript
var dts2externs = require('dts2externs').gulp();
```

Create a new `gulp` task:
```javascript
gulp.task('externs', function() {
    return gulp.src(['typings/index.d.ts'])
        .pipe(dts2externs({keepComments:true, listParsedFiles:true}))
        .pipe(gulp.dest('dist'));
});
```
_Note: added two options (_ `keepComments` _and_ `listParsedFiles` _) as an example_

### In _javascript_ code
```javascript
var dts2externs = require("dts2externs");
dts2externs.generate(['typings/index.d.ts'], {listParsedFiles:true});
```
_Ugly online example @ [Tonic](https://tonicdev.com/5797d5e86ee527120006fde8/5797d7a149cba51300e822c9)_ :grin:

### In console using _[docopt](http://docopt.org/)_ style commandline options

#### using stdin / stdout
Example with the `node` declaration file installed via `typings`.

_Note: Using stdin will create a tempfile to parse. This means relative paths in the input will not work and you'll have to concatenate stuff yourself._
```
$ cat typings/global/node/index.d.ts |dts2externs > externs.js
```

#### commandline help
```
$ dts2externs --help

Usage:
  dts2externs [--help] [options] [-chkl] [-s <style>] [ (-a [-p]) ] ([-] | <file> [<file>...]) [-o <outputfile>]

  dts2externs (-h | --help)
  dts2externs --style=(obj|proto)
  dts2externs --allow-ts [--parse-all] <file>
  dts2externs --add-console --list --keep-comments --debug <file> --output=<outputfile>

Options:
  -h, --help           Show this.
  -o, --output=FILE    Output file [default: stdout]
  -s, --style=STYLE    Output style: obj or proto [default: obj]
  -c, --add-console    Add console.log, console.error, etc.. to the output
  -k, --keep-comments  Preserve and output comments
  -l, --list           List parsed files on stdout
  -a, --allow-ts       Allow parsing of .ts files
  -p, --parse-all      Parse all (including non-exported) stuffs in .ts files
  --debug              Print some debug info to console
```

# License
This project is licensed under the MIT license
