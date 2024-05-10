# @file        dcp-support.py
#              Python polyfills for OS-level functionality needed by dcp-client
#
# @author      Will Pringle, will@distributive.network
# @author      Wes Garland, wes@distributive.network
# @author      Hamada Gasmallah, hamada@distributive.network
# @date        Feb 2024

import os
import pythonmonkey as pm

# Supply globalThis.crypto.getRandomValues
def getRandomValues(typedArr):
    setRandomVal = pm.eval("""'use strict';
function setRandomVal(typedArr, bytes)
{
  const arrBytes = typedArr.BYTES_PER_ELEMENT;
  for (let i=0; i < typedArr.length; i++)
  {
    const index = i * arrBytes;
    for (let byte=0; byte < arrBytes; byte++)
    {
      if (typedArr.constructor.name.includes('Big'))
        typedArr[i] += BigInt(bytes[index + byte]) << BigInt(arrBytes - byte - 1) * 8n
      else
        typedArr[i] += bytes[index + byte] << (arrBytes - byte - 1) * 8
    }
  }
}
setRandomVal""")
    randomBytes = memoryview(bytearray(os.urandom(typedArr.nbytes)))
    setRandomVal(typedArr, randomBytes)
    return typedArr

exports['getRandomValues'] = getRandomValues

