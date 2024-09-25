# @file        fs-basic.py
#              Python polyfills for OS-level functionality needed by dcp-client
#
# @author      Wes Garland, wes@distributive.network
# @date        Feb 2024

import os
import pythonmonkey as pm

def readFile(filename: str) -> str:
    with open(filename, "r", encoding="utf8") as fileHnd:
        return fileHnd.read()

def writeFile(filename: str, contents: str) -> None:
    with open(filename, "w", encoding="utf8") as fileHnd:
        fileHnd.write(contents)

def getMode(filename: str) -> int:
    return os.stat(filename).st_mode

def fileExists(filename: str) -> bool:
    return os.path.isfile(filename)

def dirExists(dirname: str) -> bool:
    return os.path.isdir(dirname)

def mkdir(dirname: str) -> None:
    return os.makedirs(dirname)

exports['readFile']   = readFile
exports['writeFile']  = writeFile
exports['getMode']    = getMode
exports['fileExists'] = fileExists
exports['dirExists']  = dirExists
exports['mkdir']      = mkdir
exports['constants']  = { 'W_OK': os.W_OK, 'R_OK': os.R_OK }
exports['pathResolve'] = os.path.join
exports['basename']    = os.path.basename
exports['dirname']     = os.path.dirname
exports['absPath']     = os.path.isabs
exports['joinPath']    = os.path.join
exports['pathSep']     = os.path.sep
exports['readDir']     = os.listdir
exports['rm']          = os.remove
exports['rmdir']       = os.rmdir
exports['fileSize']    = lambda filename: os.stat(filename).st_size
