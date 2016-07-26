#!/usr/bin/env node

import * as dts2externs from "./dts2externs";
import { docopt } from "docopt";
import * as fs from "fs";
import * as readline from "readline";
import * as tmp from "tmp";
import * as tty from "tty";

interface IOptions {
    "--add-console": boolean;
    "--allow-ts": boolean;
    "--debug": boolean;
    "--help": boolean;
    "--keep-comments": boolean;
    "--list": boolean;
    "--output": string;
    "--parse-all": boolean;
    "--style": string;
    "<file>": [string];
}

// convert options to parameters and generate externs
function work(output: NodeJS.WritableStream, options: IOptions) {
    let outputStyle: dts2externs.OutputStyle;
    if (options["--style"] === "obj") {
        outputStyle = dts2externs.OutputStyle.obj;
    }
    else {
        outputStyle = dts2externs.OutputStyle.proto;
    }

    let str = dts2externs.generate(options["<file>"], {
        addConsole: options["--add-console"]
        , allowTsFiles: options["--allow-ts"]
        , debugOutput: options["--debug"]
        , keepComments: options["--keep-comments"]
        , listParsedFiles: options["--list"]
        , outputStyle: outputStyle
        , parseNonExportedNodesInTsFiles: options["--parse-all"]
    });

    output.write(str);
}

// docopt usage string
let usage =
`dts2externs:

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
`;

// get options from docopt
let options: IOptions = docopt(usage, { help: true, options_first: false });

// Check if --style value is valid
if (["obj", "proto"].indexOf(options["--style"]) === -1) {
    process.stderr.write(
        `ERROR: unknown --style option "${options["--style"]}". ` +
        `Should be "obj" or "proto".See--help for more info.`
    );
    process.exit(1);
}

// Set script output
let output: NodeJS.WritableStream;

if (options["--output"] === "stdout") {
    output = process.stdout;
}
else {
    output = fs.createWriteStream(options["--output"], { flags: "w" });
}

// input is stdin
if (options["<file>"].length === 0) {
    let data = "";
    let rlOpts: readline.ReadLineOptions = { input: process.stdin };

    // TODO: workaround for issue with node.d.ts - remove when fixed
    // see:
    // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/8059
    // https://github.com/DefinitelyTyped/DefinitelyTyped/pull/7556
    // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/7454
    if ((<tty.ReadStream> process.stdin ).isTTY) {
        rlOpts.output = process.stdout;
    }

    let rl = readline.createInterface(rlOpts);

    rl.on("line", (input: string) => {
        data += input + "\n";
    });

    rl.on("close", () => {
        // create tempfile with .d.ts extension
        let tempFile = tmp.fileSync({ postfix: ".d.ts" });

        // write data to file
        fs.writeFileSync(tempFile.name, data);

        // add filename to list
        options["<file>"].push(tempFile.name);

        // gogogo
        work(output, options);
    });
}

// input is file(s)
else {
    work(output, options);
}
